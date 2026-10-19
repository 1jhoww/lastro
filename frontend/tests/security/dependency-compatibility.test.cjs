const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

test('query-string keeps the CommonJS API used by Expo Router', () => {
  const query = require('query-string');
  const parsed = query.parse(
    'nome=Jo%C3%A3o+Silva&tag=a&tag=b&vazio=&semValor&cursor=a%2Bb%2Fc%3D',
  );
  assert.deepEqual(
    { ...parsed },
    {
      nome: 'João Silva',
      tag: ['a', 'b'],
      vazio: '',
      semValor: null,
      cursor: 'a+b/c=',
    },
  );
  const encoded = query.stringify(parsed);
  assert.deepEqual({ ...query.parse(encoded) }, { ...parsed });
  assert.equal(query.parseUrl('/clientes?nome=Jo%C3%A3o').query.nome, 'João');
  assert.equal(
    query.stringifyUrl({ url: '/clientes', query: { nome: 'João' } }),
    '/clientes?nome=Jo%C3%A3o',
  );
});

test('malformed query decoding finishes in a bounded child process', () => {
  // Exercise the actual consumer without hanging the test runner if decoding regresses.
  const child = spawnSync(
    process.execPath,
    [
      '-e',
      `
    const q = require('query-string');
    const input = '%C0%AF'.repeat(2048);
    const result = q.parse('q=' + input);
    if (typeof result.q !== 'string') process.exit(2);
  `,
    ],
    { cwd: process.cwd(), timeout: 2000, encoding: 'utf8' },
  );
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, 0, child.stderr);
});

test('xcode keeps generating the UUID format consumed by Expo config plugins', () => {
  const project = require('xcode').project('synthetic.pbxproj');
  project.hash = { project: { objects: { PBXProject: {} } } };
  const ids = new Set(Array.from({ length: 32 }, () => project.generateUuid()));
  assert.equal(ids.size, 32);
  for (const id of ids) assert.match(id, /^[A-F0-9]{24}$/);
});

test('Firestore grpc transport retains its CommonJS client credentials API', () => {
  const grpc = require('@grpc/grpc-js');
  assert.equal(typeof grpc.Client, 'function');
  assert.equal(typeof grpc.credentials.createSsl, 'function');
  assert.ok(grpc.credentials.createSsl());
});
