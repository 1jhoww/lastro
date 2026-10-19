const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertRuntime } = require('../../scripts/check-runtime.cjs');

test('build accepts the supported Node 24 baseline and later Node 24 patches', () => {
  assert.doesNotThrow(() => assertRuntime('24.22.0'));
  assert.doesNotThrow(() => assertRuntime('24.23.0'));
});

test('build refuses unvalidated Node majors, older patches and malformed versions', () => {
  for (const version of ['22.23.3', '20.20.0', '24.21.0', '25.0.0', '24', 'invalid']) {
    assert.throws(() => assertRuntime(version), /Runtime não suportado/);
  }
});
