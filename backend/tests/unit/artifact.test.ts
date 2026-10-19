import { describe, expect, it } from 'vitest';
import { cp, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve, sep } from 'node:path';

describe('F06: artefato isolado de assets de desenvolvimento', () => {
  it('carrega PDFs e Sharp com assets empacotados e detecta fonte ausente', async () => {
    const local = resolve('.local');
    const root = resolve(local, `artifact-${randomUUID()}`);
    if (!root.startsWith(local + sep)) throw new Error('Diretório de teste inválido');
    await mkdir(root, { recursive: true });
    try {
      await cp('dist', root, { recursive: true });
      const run = () =>
        spawnSync(process.execPath, ['scripts/check-artifact.mjs', root], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 15_000,
        });
      const valid = run();
      expect(valid.status, valid.stderr).toBe(0);
      expect(valid.stdout).toContain('"pdf":["commercial","packing"]');
      await rm(resolve(root, 'assets/fonts/LiberationSans-Regular.ttf'));
      const missing = run();
      expect(missing.status).not.toBe(0);
      expect(missing.stderr).toContain('LiberationSans-Regular.ttf');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 35_000); // Two child processes each retain their 15-second timeout; allow package copy and parallel test load.
});
