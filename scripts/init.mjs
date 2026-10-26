import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const file = path.resolve(process.env.LIFE_CONFIG || path.join(root, 'config.local.json'));
try {
  if (fs.existsSync(file)) throw Error('config already exists; it will not be overwritten');
  const c = JSON.parse(fs.readFileSync(path.join(root, 'config.example.json'), 'utf8'));
  if (process.stdin.isTTY && !process.argv.includes('--defaults')) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const port = await rl.question('本地服务端口 [5421]：'); if (port.trim()) c.port = Number(port);
      const zone = await rl.question('时区 [Asia/Shanghai]：'); if (zone.trim()) c.bindings[0].life.timeZone = zone.trim();
      const role = await rl.question('角色名称 [companion]：'); if (role.trim()) c.bindings[0].role = role.trim();
    } finally { rl.close(); }
  }
  if (!Number.isInteger(c.port) || c.port < 1024 || c.port > 65535) throw Error('Invalid port');
  new Intl.DateTimeFormat('en', { timeZone: c.bindings[0].life.timeZone }).format();
  c.adminToken = crypto.randomBytes(32).toString('hex');
  for (const b of c.bindings) b.token = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, JSON.stringify(c, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  // npm archives omit .gitignore; protect a freshly extracted runtime too.
  const ignore = path.join(root, '.gitignore');
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, 'config.local.json\ndata/\nartifacts/\nnode_modules/\n*.tgz\n*.log\n.env\n.env.*\n', { flag: 'wx' });
  console.log('本地配置已生成；令牌只保存在 config.local.json，不会打印。下一步：npm run doctor');
} catch (e) { console.error(e.message); process.exitCode = 1; }
