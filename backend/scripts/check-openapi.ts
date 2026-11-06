import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { openApiDocument } from '../src/modules/auth/openapi.js';
import openapiTS, { astToString } from 'openapi-typescript';
const saved = JSON.parse(readFileSync('docs/api/openapi.json', 'utf8')) as ReturnType<
  typeof openApiDocument
>;
if (!isDeepStrictEqual(saved, openApiDocument())) throw new Error('OpenAPI fora de sincronia');
const generated = astToString(
  await openapiTS(new URL('../docs/api/openapi.json', import.meta.url)),
);
// Windows checkouts may hold CRLF here, while the generator always emits LF.
const savedTypes = readFileSync('docs/api/generated-types.ts', 'utf8').replaceAll('\r\n', '\n');
// CLI adds a standard banner; compare the declarations, preserving all field semantics.
if (
  savedTypes.slice(savedTypes.indexOf('export interface paths')) !==
  generated.slice(generated.indexOf('export interface paths'))
)
  throw new Error('Tipos fora de sincronia');
console.log('OpenAPI e tipos sincronizados');
