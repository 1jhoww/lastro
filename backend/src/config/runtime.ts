export const MIN_NODE_VERSION = '24.22.0';
export function assertRuntime(version = process.versions.node) {
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  const [major, minor] = parts ? parts.slice(1).map(Number) : [];
  if (major !== 24 || minor === undefined || minor < 22)
    throw new Error(`Runtime não suportado: Node ${version}; exige >=${MIN_NODE_VERSION} <25`);
}
