import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { scan } from './privacy-scan.mjs';
const findings = scan(); if (findings.length) { console.error('Release stopped: privacy scan failed'); process.exit(1); }
const checked = spawnSync(process.execPath, ['scripts/check.mjs'], { stdio: 'inherit' }); if (checked.status !== 0) process.exit(1);
const npmCli = process.env.npm_execpath;
if (!npmCli) { console.error('Run this through npm run release'); process.exit(1); }
fs.mkdirSync('artifacts', { recursive: true });
const packed = spawnSync(process.execPath, [npmCli, 'pack', '--json', '--ignore-scripts', '--pack-destination', 'artifacts'], { encoding: 'utf8' });
if (packed.status !== 0) { console.error('Local npm pack failed'); process.exit(1); }
const info = JSON.parse(packed.stdout)[0];
if (info.files.some(f => /(?:^|\/)(?:data|state|artifacts|node_modules|__pycache__)\/|config\.local\.json|\.(log|pyc|bak)$/.test(f.path))) throw Error('Private file in package; do not publish');
const file = path.join('artifacts', path.basename(info.filename));
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
fs.writeFileSync(`${file}.sha256`, `${sha256}  ${path.basename(file)}\n`);
fs.writeFileSync('artifacts/release-manifest.json', JSON.stringify({ version: info.version, archive: path.basename(file), sha256, files: info.files.map(f => f.path) }, null, 2));
console.log(`Local release ready: ${file}\nNo upload performed.`);
