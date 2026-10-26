import { spawnSync } from 'node:child_process';
import { scan, publicFiles } from './privacy-scan.mjs';
const findings = scan();
if (findings.length) { for (const f of findings) console.error(`${f.file}: ${f.rule}`); process.exit(1); }
for (const file of publicFiles().filter(f => /\.(mjs|js)$/.test(f))) {
  const checked = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' }); if (checked.status !== 0) process.exit(1);
}
const result = spawnSync(process.execPath, ['--test', 'test/core.test.mjs', 'test/integration.test.mjs', 'test/life-modes.test.mjs'], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
