import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function lockData(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, '.runtime.lock');
  if (fs.existsSync(file)) {
    let old;
    try { old = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw Error('Unreadable runtime lock; inspect it before deleting'); }
    let alive = true;
    try { process.kill(old.pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; }
    if (alive) throw Error('Another runtime owns this data directory');
    fs.unlinkSync(file);
  }
  const marker = { pid: process.pid, nonce: crypto.randomUUID() };
  fs.writeFileSync(file, JSON.stringify(marker), { flag: 'wx', mode: 0o600 });
  return () => {
    try { if (JSON.parse(fs.readFileSync(file, 'utf8')).nonce === marker.nonce) fs.unlinkSync(file); } catch {}
  };
}
