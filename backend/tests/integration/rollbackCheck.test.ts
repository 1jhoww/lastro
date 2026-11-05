import { describe, expect, it } from 'vitest';
import { registerFixture } from '../helpers/fixture.js';
import { validAddress } from '../helpers/commercial.js';
import { api, gestao, supplier } from '../helpers/management.js';
import { rollbackBlockers } from '../../src/modules/platformAdmin/rollbackCheck.js';

const f = registerFixture();
const tenantId = () => f.tenantA.tenant.id;
const stored = async (id: string) =>
  (await f.firebase.db.doc(`tenants/${tenantId()}/customers/${id}`).get()).data()!;

describe('Compatibilidade com a versão anterior da API', () => {
  it('cliente comum continua gravado no formato antigo, mesmo depois de editado', async () => {
    const created = await api(f)
      .post('/customers', { name: 'Mercado Central', address: validAddress })
      .expect(201);
    const { id, version } = created.body.data;
    expect(created.body.data).toMatchObject({ relationships: ['customer'], contactName: null });
    for (const key of ['relationships', 'isSupplier', 'contactName'])
      expect(await stored(id)).not.toHaveProperty(key);
    await api(f).patch(`/customers/${id}`, { name: 'Mercado Central Ltda', expectedVersion: version });
    for (const key of ['relationships', 'isSupplier', 'contactName'])
      expect(await stored(id)).not.toHaveProperty(key);
    expect(await rollbackBlockers(f.firebase.db)).toMatchObject({ rollbackSafe: true });
  });
  it('fornecedor e contato ficam gravados e fornecedor continua listado', async () => {
    await gestao(f);
    const vendor = await supplier(f, 'Fornecedor Teste', { contactName: 'Marina' });
    expect(await stored(vendor.id)).toMatchObject({
      relationships: ['supplier'],
      isSupplier: true,
      contactName: 'Marina',
    });
    const listed = await api(f).get('/customers?relationship=supplier').expect(200);
    expect(listed.body.data.items.map((c: { id: string }) => c.id)).toContain(vendor.id);
  });
  it('aponta o que impede reverter, sem expor o conteúdo dos registros', async () => {
    await gestao(f);
    await supplier(f, 'Fornecedor Sigiloso', { contactName: 'Marina Sigilosa' });
    const result = await rollbackBlockers(f.firebase.db);
    expect(result.rollbackSafe).toBe(false);
    expect(result.blockers.map((b) => b.reason).sort()).toEqual([
      'customer_contact',
      'plan_gestao',
      'supplier_record',
    ]);
    expect(JSON.stringify(result)).not.toContain('Sigilos');
  });
});
