import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const findings = [];
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /AIza[0-9A-Za-z_-]{35}/,
  /(?:ghp_|github_pat_)[0-9A-Za-z_]{20,}/,
  /"private_key"\s*:\s*"/,
];
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (
      ['node_modules', 'dist', '.cache', '.local', '.git', 'reports', 'coverage'].includes(
        entry.name,
      ) ||
      (entry.name.startsWith('.env') && entry.name !== '.env.example')
    )
      continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.(?:ts|js|mjs|json|md|ya?ml|example)$/.test(path)) {
      const content = readFileSync(path, 'utf8');
      if (patterns.some((pattern) => pattern.test(content))) findings.push(path);
    }
  }
}
walk('.');
console.log(JSON.stringify({ scanner: 'local-signature-check', findings }));
if (findings.length) process.exitCode = 1;
