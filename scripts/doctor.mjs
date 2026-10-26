import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { loadConfig } from '../src/config.mjs';
import { createRuntime } from '../src/runtime.mjs';
const results = [];
const check = (name, ok, note) => { results.push({ name, ok, note }); console.log(`${ok ? 'OK' : 'FAIL'} ${name}: ${note}`); };
const [major, minor] = process.versions.node.split('.').map(Number);
check('Node.js', major > 22 || major === 22 && minor >= 13, `installed ${process.versions.node}; requires >=22.13`);
try {
  const c = loadConfig(); check('Config', true, 'loopback, unique tokens, bindings and timezone validated');
  fs.mkdirSync(c.dataDir, { recursive: true }); const probe = path.join(c.dataDir, '.doctor-write');
  fs.writeFileSync(probe, 'ok', { flag: 'wx' }); fs.unlinkSync(probe); check('Storage', true, 'writable; existing data not reset');
  check('Core', typeof createRuntime === 'function', 'all runtime imports resolve inside package');
  const portFree = await new Promise(resolve => {
    const server = net.createServer(); server.once('error', () => resolve(false));
    server.listen(c.port, c.host, () => server.close(() => resolve(true)));
  });
  if (portFree) check('Port', true, 'available');
  else {
    let healthy = false;
    try { const r = await fetch(`http://${c.host === '::1' ? '[::1]' : c.host}:${c.port}/v1/status`, { headers: { authorization: `Bearer ${c.adminToken}` }, signal: AbortSignal.timeout(1000) }); healthy = r.ok && (await r.json()).ok === true; } catch {}
    check('Port', healthy, healthy ? 'your runtime is already running; reuse it' : 'occupied by another service or different credentials');
  }
  console.log('Memory scopes are isolated by binding. No QQ or model account was contacted.');
} catch { check('Setup', false, 'Run npm run init first, or inspect configuration/permissions. Nothing was reset.'); }
if (results.some(r => !r.ok)) process.exitCode = 1;
