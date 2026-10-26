import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export const PUBLIC_FILES = ['src', 'scripts', 'test', 'adapters', 'examples', 'docs', '.github',
  'README.md', 'LICENSE', 'SECURITY.md', 'CONTRIBUTING.md', 'PROVENANCE.md', 'CHANGELOG.md', 'config.example.json',
  'package.json', 'package-lock.json', '.gitignore', 'Start.bat', 'Start.sh'];
export function publicFiles(base = root) {
  const files = [];
  const walk = rel => {
    const full = path.join(base, rel);
    if (!fs.existsSync(full)) return;
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) throw Error('Public source must not contain symlinks');
    if (stat.isDirectory()) for (const name of fs.readdirSync(full)) walk(path.join(rel, name));
    else files.push(rel.replaceAll('\\', '/'));
  };
  for (const p of PUBLIC_FILES) walk(p);
  return files;
}
export function scan(base = root) {
  const findings = [];
  for (const name of fs.readdirSync(base)) {
    if (!PUBLIC_FILES.includes(name) && !['.git', 'config.local.json', 'data', 'artifacts', 'node_modules'].includes(name)) findings.push({ file: name, rule: 'Unexpected root file; review before publishing' });
  }
  const rules = [
    ['Windows personal path', /[A-Za-z]:[\\/]+Users[\\/]+[^\s"'`]+/i],
    ['Machine drive path', /[DEFG]:[\\/]+(?:za_wu|QQ|app)[\\/]/i],
    ['Account identifier', /(?<!\d)[1-9]\d{8,10}(?!\d)/],
    ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['Credential URL', /https?:\/\/[^/\s:@]+:[^/\s@]+@/],
    ['Hardcoded token assignment', /(?:token|secret|apiKey|password)["']?\s*[:=]\s*["'][a-zA-Z0-9_+/=-]{32,}["']/i],
  ];
  for (const rel of publicFiles(base)) {
    if (/\.png$/.test(rel)) {
      const bytes = fs.readFileSync(path.join(base, rel));
      if (bytes.length > 10 * 1024 * 1024 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) findings.push({ file: rel, rule: 'Invalid or oversized raster asset' });
      continue;
    }
    if (/\.(pyc|log|bak|zip|tgz)$|(?:^|\/)(?:data|state|node_modules|__pycache__)(?:\/|$)|config\.local\.json$/.test(rel)) { findings.push({ file: rel, rule: 'Private/generated file in release allowlist' }); continue; }
    const content = fs.readFileSync(path.join(base, rel), 'utf8');
    for (const [name, pattern] of rules) if (pattern.test(content)) findings.push({ file: rel, rule: name });
  }
  return findings;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const findings = scan();
  for (const f of findings) console.error(`${f.file}: ${f.rule}`); // Never print the matched secret.
  console.log(`Privacy scan: ${publicFiles().length} allowlisted files, ${findings.length} findings`);
  if (findings.length) process.exitCode = 1;
}
