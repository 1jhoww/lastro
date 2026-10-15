// Gera o contrato a partir do código-fonte atual do backend, sem escrever na pasta do backend.
import { mkdirSync, writeFileSync } from 'node:fs';
import { openApiDocument } from '../../backend/src/modules/auth/openapi.js';

const out = 'contract/openapi.json';
mkdirSync('contract', { recursive: true });
writeFileSync(out, JSON.stringify(openApiDocument(), null, 2) + '\n');
console.log(`Contrato gerado em ${out}`);
