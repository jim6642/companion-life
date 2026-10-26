import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRuntime } from '../src/runtime.mjs';
import { createHttpServer } from '../src/http.mjs';
import { LifeClient, runChatTurn } from '../src/adapters/http-client.mjs';

// Deterministic model stub. No model API, QQ account or external connection.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-life-demo-'));
const config = { dataDir: dir, adminToken: crypto.randomBytes(32).toString('hex'), bindings: [{ id: 'demo', token: crypto.randomBytes(32).toString('hex'), kind: 'private', role: 'student', persona: '虚拟大学生', life: { enabled: true, timeZone: 'Asia/Shanghai', detailGate: { enabled: true } } }] };
const clock = () => Date.parse('2026-01-10T09:30:00+08:00');
const runtime = createRuntime(config, { clock });
const server = createHttpServer(config, runtime);
try {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const client = new LifeClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, token: config.bindings[0].token });
  const evidence = '早饭吃了小笼包和豆浆';
  const result = await runChatTurn({ client, userText: '早饭吃什么', generate: async ({ propose }) => {
    await propose({ lifeEvents: [{ date: '2026-01-10', slotId: 'breakfast', status: 'completed', subject: 'character', basis: 'own_virtual_experience', certainty: 'settled', details: { food: '小笼包', drink: '豆浆' }, evidence }] });
    return evidence;
  }, send: async messages => { console.log('模拟发送:', messages.join(' / ')); return { status: 'success', deliveredMessages: messages }; } });
  if (!result.memory.life.ok) throw Error('Recording failed');
  const restored = createRuntime(config, { clock });
  if (!restored.context('demo', '早饭').includes('小笼包')) throw Error('Recovery failed');
  console.log('成功：发送确认后保存；重新加载后早餐细节仍在。未调用真实模型或 QQ。');
} finally {
  await new Promise(r => { server.close(r); server.closeAllConnections(); });
  if (path.dirname(dir) !== os.tmpdir() || !path.basename(dir).startsWith('companion-life-demo-')) throw Error('Unsafe cleanup');
  fs.rmSync(dir, { recursive: true, force: true });
}
