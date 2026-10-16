import { z } from 'zod';
import { routeDefinitions } from '../../app/routes.js';
import { errorView } from '../../shared/schemas/http.js';
const jsonSchema = (schema: z.ZodType, io: 'input' | 'output' = 'input') =>
  z.toJSONSchema(schema, { target: 'draft-2020-12', io });
export function openApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routeDefinitions) {
    const path = `/api/v1${r.path.replace(/:([a-zA-Z]+)/g, '{$1}')}`;
    const parameters: unknown[] = [];
    if (r.scope === 'tenant')
      parameters.push({
        in: 'header',
        name: 'X-Tenant-Id',
        required: true,
        description: 'Empresa candidata, validada pelo vínculo ativo no servidor.',
        schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,128}$' },
      });
    if (r.idempotent)
      parameters.push({
        in: 'header',
        name: 'Idempotency-Key',
        required: true,
        schema: { type: 'string', format: 'uuid' },
      });
    for (const [location, schema] of [
      ['path', r.params],
      ['query', r.query],
    ] as const) {
      if (!schema) continue;
      const object = jsonSchema(schema);
      const properties = object.properties ?? {};
      for (const [name, value] of Object.entries(properties))
        parameters.push({
          in: location,
          name,
          required: location === 'path' || object.required?.includes(name) || false,
          schema: value,
        });
    }
    const responses: Record<string, unknown> = {
      [r.status ?? 200]: {
        description: 'Operação concluída',
        ...(r.downloadType
          ? {
              headers: {
                'Content-Disposition': {
                  description: 'attachment com nome ASCII seguro',
                  schema: { type: 'string' },
                },
                'Cache-Control': { schema: { type: 'string', const: 'private, no-store' } },
                ...(r.downloadType === 'text/csv'
                  ? {
                      'X-Next-Cursor': {
                        description:
                          'Presente somente se houver próxima página; repetir filtros e limit.',
                        schema: { type: 'string' },
                      },
                      'X-Export-Row-Count': {
                        description: 'Número de registros desta página, sem cabeçalho.',
                        schema: { type: 'integer', minimum: 0, maximum: 100 },
                      },
                    }
                  : {}),
              },
            }
          : {}),
        content: r.binaryOutput
          ? { [r.downloadType ?? 'image/webp']: { schema: { type: 'string', format: 'binary' } } }
          : {
              'application/json': {
                schema: jsonSchema(
                  z.strictObject({ data: r.output, requestId: z.string().uuid() }),
                  'output',
                ),
              },
            },
      },
    };
    if (r.executionResponse)
      responses[202] = {
        description:
          'Execução aceita ou em processamento; financialCompleted=false, result=null. Avançar ou consultar até publicação.',
        content: {
          'application/json': {
            schema: jsonSchema(
              z.strictObject({ data: r.output, requestId: z.string().uuid() }),
              'output',
            ),
          },
        },
      };
    for (const code of [400, 401, 403, 404, 409, 410, 413, 415, 422, 429, 500, 503])
      responses[code] = {
        description: 'Erro seguro com código estável',
        content: { 'application/json': { schema: jsonSchema(errorView, 'output') } },
      };
    paths[path] ??= {};
    paths[path][r.method] = {
      operationId: r.operationId,
      ...(r.description ? { description: r.description } : {}),
      tags: [r.scope],
      security: r.scope === 'public' ? [] : [{ firebaseIdToken: [] }],
      parameters,
      responses,
      'x-permission': r.permission ?? r.scope,
      'x-idempotency': r.idempotent
        ? 'required'
        : r.method === 'patch' || r.method === 'delete' || r.rawImage
          ? 'expectedVersion'
          : r.scope === 'invitation'
            ? 'single-use'
            : 'none',
      ...(r.rawImage
        ? {
            requestBody: {
              required: true,
              description:
                'Bytes da imagem; máximo 5 MiB, 16 milhões de pixels. Não aceita URL nem multipart.',
              content: Object.fromEntries(
                ['image/jpeg', 'image/png', 'image/webp'].map((type) => [
                  type,
                  { schema: { type: 'string', format: 'binary' } },
                ]),
              ),
            },
          }
        : r.body
          ? {
              requestBody: {
                required: true,
                content: { 'application/json': { schema: jsonSchema(r.body) } },
              },
            }
          : {}),
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Lastro — Fases A, B, C, D, E, F e G',
      version: '0.9.0',
      description:
        'Firebase Client SDK: login, signOut e recuperação de senha. Não há login JWT paralelo. Headers de tenant não concedem autorização. Operações sensíveis exigem autenticação recente (5 minutos). Convites exigem email verificado e não enviam email automaticamente. Pedidos sem teto comercial de linhas ou valor mínimo; rascunhos podem estar incompletos. Confirmar exige cliente autorizado, linhas e quantidades válidas, total positivo, estoque e condição válida, verificados no servidor. Refinamentos transacionais não são expressos integralmente em JSON Schema. Financeiro administrativo: condições empresariais até 12 parcelas, forma prevista separada da efetiva, alocações restritas a um pedido, recebimentos sem excedente. Centavos determinísticos; parcelas zero sem liquidação fictícia. Devoluções físicas parciais referenciam expedição, danificados ficam fora do disponível e exigem decisão administrativa. Bloqueio financeiro desde intenção até encerramento físico e resolução. Todos os efeitos críticos são atômicos e versionados; replay exige autorização atual. Limites técnicos: JSON 64 KiB, documento Firestore 1 MiB; excedentes são recusados integralmente.',
    },
    servers: [{ url: 'http://127.0.0.1:3000', description: 'Emuladores locais' }],
    paths,
    components: {
      securitySchemes: {
        firebaseIdToken: { type: 'http', scheme: 'bearer', bearerFormat: 'Firebase ID Token' },
      },
    },
  };
}
