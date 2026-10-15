import { mkdir, readFile, writeFile } from 'node:fs/promises';

export async function financialCapacityReport(
  record: { f02Capacity: string } & Record<string, unknown>,
) {
  const path = 'reports/f02-capacity.raw.json';
  await mkdir('reports', { recursive: true });
  let previous: unknown[] = [];
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (Array.isArray(value)) previous = value;
  } catch {
    // First capacity case in this local run.
  }
  previous = previous.filter(
    (value) =>
      value &&
      typeof value === 'object' &&
      'f02Capacity' in value &&
      value.f02Capacity !== record.f02Capacity,
  );
  await writeFile(path, JSON.stringify([...previous, record], null, 2));
}
