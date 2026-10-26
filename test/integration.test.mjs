import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fixture, temp, event, lifeConfig } from './helpers.mjs';
import { runChatTurn } from '../src/adapters/http-client.mjs';
import { createOneBotSender } from '../src/adapters/onebot-http.mjs';
import { handleMcp, MCP_TOOLS } from '../src/mcp.mjs';
import { loadConfig } from '../src/config.mjs';
import { lockData } from '../src/lock.mjs';
import { scan } from '../scripts/privacy-scan.mjs';

test('HTTP auth, Origin, binding isolation and host-only commit capability', async t => {
  const { baseUrl, client, config } = await fixture(t);
  const req = (route, token, body, headers = {}) => fetch(baseUrl + route, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await req('/v1/status', 'wrong')).status, 401);
  assert.equal((await req('/v1/status', config.adminToken, null, { Origin: 'https://example.org' })).status, 403);
  assert.equal((await req('/v1/turns', config.adminToken, { userText: 'hello' })).status, 403);
  assert.equal((await req('/v1/context', config.bindings[0].token, { bindingId: 'other' })).status, 403);
  const turn = await client.call('/v1/turns', { userText: '早餐呢' });
  assert.doesNotMatch(turn.context + turn.instruction, new RegExp(turn.commitToken));
  assert.equal((await req(`/v1/turns/${turn.turnId}/propose`, config.bindings[1].token, {})).status, 404);
  await assert.rejects(client.call(`/v1/turns/${turn.turnId}/commit`, { delivery: { status: 'success' }, deliveredMessages: ['你好'] }), /403/);
  await client.call(`/v1/turns/${turn.turnId}/propose`, { lifeEvents: [event()] });
  const body = { commitToken: turn.commitToken, delivery: { status: 'success' }, deliveredMessages: [event().evidence] };
  const committed = await client.call(`/v1/turns/${turn.turnId}/commit`, body);
  assert.equal(committed.life.ok, true);
  assert.deepEqual(await client.call(`/v1/turns/${turn.turnId}/commit`, body), committed);
  assert.match((await client.call('/v1/context', { query: '早饭' })).context, /小笼包/);
});
test('full mock model → real HTTP → mock OneBot receipt → persisted fact, no extra model pass', async t => {
  const { client, runtime, config } = await fixture(t); let generates = 0, sends = 0;
  const gateway = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const message = JSON.parse(body); assert.equal(req.url, '/send_private_msg');
    assert.equal(message.message[0].data.text, event().evidence); sends++;
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: 'mock-message' } }));
  });
  await new Promise(r => gateway.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => gateway.close(r)));
  const send = createOneBotSender({ baseUrl: `http://127.0.0.1:${gateway.address().port}`, kind: 'private', targetId: '42' });
  const result = await runChatTurn({ client, userText: '早餐吃什么', generate: async args => {
    generates++; assert.equal(args.commitToken, undefined); assert.match(args.context, /上高数课/);
    await args.propose({ lifeEvents: [event()] }); return event().evidence;
  }, send });
  assert.equal(result.delivered, true); assert.equal(generates, 1); assert.equal(sends, 1);
  assert.equal(runtime.stats().openTurns, 0);
  assert.match(fs.readFileSync(path.join(config.dataDir, 'demo', 'life.json'), 'utf8'), /小笼包/);
});
test('send failure cannot confirm memory; successful send with failed persistence is never resent', async t => {
  const { client, runtime, config } = await fixture(t); let sends = 0;
  const generate = async ({ propose }) => { await propose({ lifeEvents: [event()] }); return event().evidence; };
  await assert.rejects(runChatTurn({ client, userText: '早餐', generate, send: async () => { sends++; throw Error('unknown'); } }), /unknown/);
  assert.deepEqual(runtime.bindings.get('demo').life.snapshot('companion').slots[0].details, {});
  const file = path.join(config.dataDir, 'demo', 'life.json.tmp'); fs.mkdirSync(file);
  const result = await runChatTurn({ client, userText: '早餐', generate, send: async messages => { sends++; return { status: 'success', deliveredMessages: messages }; } });
  assert.equal(result.delivered, true); assert.equal(result.memory.life.ok, false); assert.equal(result.noResend, true); assert.equal(sends, 2);
});
test('runtime unavailable leaves existing reply path working; failed fallback receipt is not success', async () => {
  let count = 0;
  const args = { client: { call: async () => { throw Error('offline'); } }, userText: '你好', generate: async ({ context }) => { assert.equal(context, ''); return '你好'; }, send: async () => { count++; return { status: 'success' }; } };
  assert.equal((await runChatTurn(args)).memory.unavailable, true); assert.equal(count, 1);
  await assert.rejects(runChatTurn({ ...args, send: async () => ({ status: 'failed' }) }), /delivery/);
});
test('MCP schema exposes no delivery commit; malformed messages stay isolated', async () => {
  for (const request of [null, [], {}, { jsonrpc: '2.0', method: 'ping', params: null }]) assert.equal((await handleMcp({}, request)).error.code, -32600);
  assert.equal((await handleMcp({}, { jsonrpc: '2.0', method: 'notifications/initialized' })), null);
  assert.deepEqual(MCP_TOOLS.map(t => t.name), ['life_context', 'life_propose']);
  const response = await handleMcp({ call: async () => ({ ok: true, context: 'test' }) }, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'life_context', arguments: {} } });
  assert.equal(response.result.isError, undefined);
});
test('MCP actual stdio process handshake, invalid JSON, then valid request', async t => {
  const { config, server } = await fixture(t);
  const file = path.join(temp(t), 'config.json'); fs.writeFileSync(file, JSON.stringify({ ...config, version: 1, port: server.address().port }));
  const child = spawn(process.execPath, ['src/mcp.mjs'], { env: { ...process.env, LIFE_CONFIG: file }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill()); let output = '', stderr = '';
  child.stdout.on('data', b => output += b); child.stderr.on('data', b => stderr += b);
  child.stdin.end('null\n{bad\n' + JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }) + '\n');
  await once(child, 'close'); assert.equal(stderr, '');
  const lines = output.trim().split('\n').map(JSON.parse); assert.equal(lines.length, 3); assert.equal(lines[0].error.code, -32600); assert.equal(lines[1].error.code, -32700); assert.equal(lines[2].result.serverInfo.name, 'companion-life');
});
test('config rejects remote exposure, duplicate credentials and group private features; writer lock protects data', t => {
  const dir = temp(t), file = path.join(dir, 'config.json');
  const base = { version: 1, host: '127.0.0.1', port: 5421, dataDir: './data', adminToken: 'a'.repeat(40), bindings: [{ id: 'demo', token: 'b'.repeat(40), kind: 'private', role: 'student', persona: '', life: lifeConfig() }] };
  const load = c => { fs.writeFileSync(file, JSON.stringify(c)); return loadConfig(file); };
  assert.equal(load(base).dataDir, path.join(dir, 'data'));
  assert.throws(() => load({ ...base, host: '0.0.0.0' }));
  assert.throws(() => load({ ...base, adminToken: base.bindings[0].token }));
  assert.throws(() => load({ ...base, bindings: [{ ...base.bindings[0], kind: 'group' }] }));
  const release = lockData(dir); assert.throws(() => lockData(dir)); release(); lockData(dir)();
});
test('privacy scanner rejects personal identifiers, generated data and unexpected root files', t => {
  const dir = temp(t); fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'sample.js'), 'const id = "' + '7'.repeat(10) + '";');
  assert.equal(scan(dir)[0].rule, 'Account identifier');
  fs.writeFileSync(path.join(dir, 'accidental.txt'), 'private'); assert.ok(scan(dir).some(f => /Unexpected/.test(f.rule)));
});

test('HTTP rejects hostile Host; Chinese UTF-8 survives byte-split transfer', async t => {
  const { baseUrl, config, runtime } = await fixture(t);
  const token = config.bindings[0].token;
  async function raw(body, headers = {}) {
    return new Promise((resolve, reject) => {
      const request = http.request(baseUrl + '/v1/turns', { method: 'POST', headers: { authorization: `Bearer ${token}`, ...headers } }, res => {
        let data = ''; res.on('data', b => data += b); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      });
      request.on('error', reject);
      const buffer = Buffer.from(body);
      for (const byte of buffer) request.write(Buffer.from([byte]));
      request.end();
    });
  }
  assert.equal((await raw('{}', { host: 'hostile.example' })).status, 403);
  const response = await raw(JSON.stringify({ userText: '你好，早饭吃什么？' }));
  assert.equal(response.status, 200); assert.match(response.body.context, /09:30/);
  runtime.commit('demo', response.body.turnId, { commitToken: response.body.commitToken, delivery: { status: 'failed' } });
  assert.equal((await raw('null')).status, 400);
});

test('expired turns close, disabled life emits no guidance, groups cannot persist private plans', async t => {
  let now = Date.parse('2026-01-10T09:30:00+08:00');
  const { runtime } = await fixture(t, { clock: () => now });
  const turn = runtime.startTurn('demo', { userText: '你好' });
  now += 16 * 60000;
  assert.throws(() => runtime.propose('demo', turn.turnId, {}), /expired/);
  const entry = runtime.bindings.get('demo'); entry.b.life.enabled = false;
  const off = runtime.startTurn('demo', { userText: '你好' });
  assert.equal(off.context, ''); assert.equal(off.instruction, '');
  runtime.commit('demo', off.turnId, { commitToken: off.commitToken, delivery: { status: 'failed' } });
  entry.b.life.enabled = true; entry.b.kind = 'group';
  const group = runtime.startTurn('demo', { userText: '陪我' });
  runtime.propose('demo', group.turnId, { futurePlans: [{}] });
  const result = runtime.commit('demo', group.turnId, { commitToken: group.commitToken, delivery: { status: 'success' }, deliveredMessages: ['好'] });
  assert.equal(result.plans.ok, false);
});

test('story proposal is staged until delivery; after reload it is available only in its own binding', async t => {
  const life = { ...lifeConfig(), stories: { enabled: true } };
  const { runtime, config, client } = await fixture(t, { life });
  const change = { action: 'create', date: '2026-01-10', subject: 'character', basis: 'own_virtual_experience', title: '小王子', category: 'reading', progress: '刚开始读', nextStep: '明天继续', facts: { book: '小王子' }, evidence: '小王子刚开始读，明天继续' };
  const turn = await client.call('/v1/turns', { userText: '最近看什么书' });
  await client.call(`/v1/turns/${turn.turnId}/propose`, { lifeStories: [change] });
  assert.doesNotMatch(runtime.context('demo', '最近'), /连续生活线/);
  const result = await client.call(`/v1/turns/${turn.turnId}/commit`, { commitToken: turn.commitToken, delivery: { status: 'success' }, deliveredMessages: [change.evidence] });
  assert.equal(result.stories.recorded, 1);
  const { createRuntime } = await import('../src/runtime.mjs');
  const restored = createRuntime(config, { clock: () => Date.parse('2026-01-11T09:30:00+08:00') });
  assert.match(restored.context('demo', '那本书'), /刚开始读/);
  assert.doesNotMatch(restored.context('other', '那本书'), /小王子/);
  const second = runtime.startTurn('demo', { userText: '读完了吗' });
  runtime.propose('demo', second.turnId, { lifeStories: [{ ...change, action: 'complete', id: result.stories.ids[0], expectedRevision: 1, progress: '读完了', evidence: '读完了' }] });
  runtime.commit('demo', second.turnId, { commitToken: second.commitToken, delivery: { status: 'failed' } });
  assert.match(runtime.context('demo', '那本书'), /刚开始读/);
});

test('chat calendar reserves after delivery and rejects overlapping proposal before another send', async t => {
  const life = { ...lifeConfig(), calendar: { enabled: true } };
  const { runtime, client } = await fixture(t, { life });
  const c = { action: 'create', date: '2026-01-10', time: '21:00', title: '一起看电影', durationMinutes: 90, requestEvidence: '九点一起看电影', evidence: '好，九点一起看电影' };
  const first = await client.call('/v1/turns', { userText: c.requestEvidence });
  await client.call(`/v1/turns/${first.turnId}/propose`, { futurePlans: [c] });
  assert.doesNotMatch(runtime.context('demo', '晚上'), /一起看电影/);
  const result = await client.call(`/v1/turns/${first.turnId}/commit`, { commitToken: first.commitToken, delivery: { status: 'success' }, deliveredMessages: [c.evidence] });
  assert.equal(result.plans.scheduleChanged, true); assert.match(runtime.context('demo', '晚上'), /一起看电影/);
  const clash = { ...c, title: '一起玩游戏', requestEvidence: '九点一起玩游戏', evidence: '好，九点一起玩游戏' };
  const second = await client.call('/v1/turns', { userText: clash.requestEvidence });
  await assert.rejects(client.call(`/v1/turns/${second.turnId}/propose`, { futurePlans: [clash] }), /409/);
  runtime.commit('demo', second.turnId, { commitToken: second.commitToken, delivery: { status: 'failed' } });
  assert.doesNotMatch(runtime.context('demo', '晚上'), /一起玩游戏/);
});

test('life panel serves local assets, requires admin, browses without writing and audits correction/retract/restore', async t => {
  const {runtime,baseUrl,config}=await fixture(t),entry=runtime.bindings.get('demo');
  entry.life.record('companion',[event()],[event().evidence],'demo');
  assert.equal((await fetch(baseUrl+'/life')).status,200);assert.equal((await fetch(baseUrl+'/favicon.ico')).status,204);
  assert.equal((await fetch(baseUrl+'/life/api/view',{headers:{authorization:'Bearer '+config.bindings[0].token}})).status,403);
  const headers={authorization:'Bearer '+config.adminToken,'content-type':'application/json'};
  const listing=await (await fetch(baseUrl+'/life/api/bindings',{headers})).json();assert.equal(listing.bindings.length,2);assert.ok(!JSON.stringify(listing).includes(config.bindings[0].token));
  const file=path.join(config.dataDir,'demo','life.json'),before=fs.readFileSync(file,'utf8');
  const tomorrow=await (await fetch(baseUrl+'/life/api/view?binding=demo&date=2026-01-11',{headers})).json();assert.equal(tomorrow.view.preview,true);assert.equal(fs.readFileSync(file,'utf8'),before);
  const view=async()=> (await (await fetch(baseUrl+'/life/api/view?binding=demo',{headers})).json()).view;
  let record=(await view()).timeline.find(r=>r.canEdit);
  const revise=async(action,reason,details)=>{const r=await fetch(baseUrl+'/life/api/records/revise?binding=demo',{method:'POST',headers,body:JSON.stringify({date:record.date,slotId:record.slotId,expectedVersion:record.version,action,reason,...(details?{details}:{})})});assert.equal(r.status,200,await r.clone().text());};
  await revise('correct','核对食物名称',{food:'小笼汤包',drink:'豆浆'});record=(await view()).timeline.find(r=>r.canEdit);assert.equal(record.details.food,'小笼汤包');
  await revise('retract','暂未核实');record=(await view()).timeline.find(r=>r.canRestore);assert.ok(record);
  await revise('restore','已经核对');assert.equal((await view()).timeline.find(r=>r.canEdit).details.food,'小笼汤包');
  assert.equal(JSON.parse(fs.readFileSync(file)).revisions.at(-1).type,'operator_restore');
});


test('life mode changes require admin and do not rewrite existing day or another binding',async t=>{
 const {runtime,baseUrl,config}=await fixture(t),entry=runtime.bindings.get('demo');entry.life.snapshot('companion');
 const headers={authorization:'Bearer '+config.adminToken,'content-type':'application/json'};
 const view=async()=> (await (await fetch(baseUrl+'/life/api/view?binding=demo',{headers})).json()).view;
 const before=await view();const body={id:'researcher',notes:'偏爱自然科学',expectedVersion:before.lifeMode.version};
 assert.equal((await fetch(baseUrl+'/life/api/mode?binding=demo',{method:'POST',headers:{authorization:'Bearer '+config.bindings[0].token,'content-type':'application/json'},body:JSON.stringify(body)})).status,403);
 let r=await fetch(baseUrl+'/life/api/mode?binding=demo',{method:'POST',headers,body:JSON.stringify(body)});assert.equal(r.status,200);assert.equal((await r.json()).effectiveDate,'2026-01-11');
 assert.deepEqual((await view()).timeline,before.timeline);assert.equal((await view()).lifeMode.selected.id,'researcher');
 r=await fetch(baseUrl+'/life/api/mode?binding=demo',{method:'POST',headers,body:JSON.stringify(body)});assert.equal(r.status,409);
});
