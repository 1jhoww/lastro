import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Inventory only: never stages files, changes Git, copies secrets or publishes artifacts.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = spawnSync(
  'git',
  [
    '-c',
    `safe.directory=${root.replaceAll('\\', '/')}`,
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
  ],
  { cwd: root, encoding: 'utf8' },
);
if (git.status !== 0) throw new Error('Cannot inventory repository files');
const denied =
  /(^|\/)(?:node_modules|dist|\.local|\.cache|\.expo|\.git|\.vercel|coverage|reports|graphify-out|evidence|emulator-data|firebase-export[^/]*)(\/|$)|(?:\.log|\.raw\.json|\.key|\.pem|\.p8|\.p12|\.pfx|\.jks|\.keystore|\.mobileprovision|\.zip|\.tgz|\.map)$|service-account|(?:^|\/)\.env(?:\.|$)/i;
const requiredBuildConfig = /^(?:backend\/tsconfig\.build\.json|frontend\/\.vercelignore)$/;
const allowed =
  /^(?:(?:backend|frontend)\/(?:src|assets|public|scripts|tests|patches|contract)\/|backend\/docs\/api\/|(?:backend|frontend)\/(?:README\.md|AGENTS\.md|package(?:-lock)?\.json|[^/]*config\.(?:json|js|mjs|cjs|ts)|(?:app|vercel|firebase)\.json|firestore\.(?:indexes\.json|rules)|storage\.rules|Dockerfile|\.npmrc|\.node-version|\.dockerignore|\.gcloudignore|\.gitignore|\.prettierignore|\.prettierrc\.json|\.env\.example)$|\.github\/workflows\/|ops\/prepublication\/|scripts\/prepare-release-candidate\.mjs$|docs\/audits\/[^/]+\.md$|(?:README\.md|AGENTS\.md|\.node-version|\.gitignore|\.vercelignore)$)/;
const signatures = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['google-api-key', /AIza[0-9A-Za-z_-]{35}/],
  ['github-token', /(?:ghp_|github_pat_)[0-9A-Za-z_]{20,}/],
  ['service-account-key', /"private_key"\s*:\s*"/],
  ['jwt', /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/],
];
const files = [],
  excluded = [],
  findings = [];
for (const path of [...new Set(git.stdout.split('\0').filter(Boolean))].sort()) {
  if (
    (denied.test(path) && !path.endsWith('/.env.example')) ||
    (!allowed.test(path) && !requiredBuildConfig.test(path))
  ) {
    excluded.push({
      path,
      reason: 'outside-source-allowlist-or-generated-private',
    });
    continue;
  }
  const absolute = resolve(root, path);
  if (!absolute.startsWith(root + '/') && !absolute.startsWith(root + '\\'))
    throw new Error('Path escaped repository');
  const stat = lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error(`Unsupported candidate entry: ${path}`);
  const bytes = readFileSync(absolute);
  if (/\.(?:[cm]?js|ts|tsx|json|md|ya?ml|rules|example)$/.test(path)) {
    for (const [kind, pattern] of signatures)
      if (pattern.test(bytes.toString('utf8'))) findings.push({ path, kind });
  }
  files.push({
    path,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}
const output = resolve(root, 'backend/.local/saneamento/candidate-files.json');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      mode: 'local-inventory-only',
      files,
      excluded,
      findings,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({
    included: files.length,
    excluded: excluded.length,
    findings,
    manifest: output,
  }),
);
if (findings.length) process.exitCode = 1;
