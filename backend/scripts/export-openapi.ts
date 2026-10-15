import { mkdirSync, writeFileSync } from 'node:fs';
import { openApiDocument } from '../src/modules/auth/openapi.js';
mkdirSync('docs/api', { recursive: true });
writeFileSync('docs/api/openapi.json', JSON.stringify(openApiDocument(), null, 2) + '\n');
console.log('Contrato gerado em docs/api/openapi.json');
