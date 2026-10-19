const MIN_NODE_VERSION = '24.12.0';

function assertRuntime(version = process.versions.node) {
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  const [major, minor] = parts ? parts.slice(1).map(Number) : [];
  if (major !== 24 || minor === undefined || minor < 12) {
    throw new Error(`Runtime não suportado: Node ${version}; exige >=${MIN_NODE_VERSION} <25`);
  }
}

module.exports = { assertRuntime };
if (require.main === module) {
  assertRuntime();
  console.log(`Runtime validado: Node ${process.versions.node}`);
}
