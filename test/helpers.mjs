import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRuntime } from '../src/runtime.mjs';
import { createHttpServer } from '../src/http.mjs';
import { LifeClient } from '../src/adapters/http-client.mjs';
export function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-life-test-'));
  t.after(() => {
    if (path.dirname(dir) !== os.tmpdir() || !path.basename(dir).startsWith('companion-life-test-')) throw Error('Unsafe cleanup');
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
export const lifeConfig = () => ({ enabled: true, timeZone: 'Asia/Shanghai', detailGate: { enabled: true }, weeklySummary: { enabled: true }, futurePlans: { enabled: true }, proactive: { enabled: false }, schedule: [
  { id: 'breakfast', start: '08:00', end: '08:30', activity: '吃早饭' },
  { id: 'morning', start: '08:30', end: '11:30', activity: '上高数课' },
  { id: 'afternoon', start: '14:00', end: '17:00', activity: '阅读' },
] });
export const event = (overrides = {}) => ({ date: '2026-01-10', slotId: 'breakfast', status: 'completed', subject: 'character', basis: 'own_virtual_experience', certainty: 'settled', details: { food: '小笼包', drink: '豆浆' }, evidence: '早饭吃了小笼包和豆浆', ...overrides });
export async function fixture(t, { life = lifeConfig(), clock = () => Date.parse('2026-01-10T09:30:00+08:00') } = {}) {
  const dataDir = temp(t);
  const config = { host: '127.0.0.1', port: 0, dataDir, adminToken: crypto.randomBytes(32).toString('hex'), bindings: ['demo', 'other'].map(id => ({ id, token: crypto.randomBytes(32).toString('hex'), kind: 'private', role: 'companion', persona: '喜欢阅读的虚拟伙伴', life })) };
  const runtime = createRuntime(config, { clock });
  const server = createHttpServer(config, runtime);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => { server.close(r); server.closeAllConnections(); }));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const client = new LifeClient({ baseUrl, token: config.bindings[0].token });
  return { config, runtime, server, baseUrl, client };
}
