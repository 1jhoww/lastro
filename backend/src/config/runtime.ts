export const MIN_NODE_VERSION = '22.23.3';
export function assertRuntime(version = process.versions.node) {
  const [major, minor, patch] = version.split('.').map(Number);
  if (
    major !== 22 ||
    minor === undefined ||
    patch === undefined ||
    minor < 23 ||
    (minor === 23 && patch < 3)
  )
    throw new Error(`Runtime não suportado: Node ${version}; exige >=${MIN_NODE_VERSION} <23`);
}
