import {
  customerFormSchema,
  emptyCustomerForm,
  formToCreate as customerCreate,
  formToUpdate as customerUpdate,
} from '@/features/customers/form';
import {
  emptyProductForm,
  formToCreate as productCreate,
  formToUpdate as productUpdate,
  productFormSchema,
  productToForm,
} from '@/features/products/form';
import { formatDocument, formatPhone, formatPostalCode, validDocument } from '@/lib/document';
import { product } from '../support/fakeApi';

describe('CPF/CNPJ (mesma regra do backend)', () => {
  it.each([
    ['529.982.247-25', true],
    ['52998224725', true],
    ['529.982.247-24', false],
    ['111.111.111-11', false],
    ['11.222.333/0001-81', true],
    ['11.222.333/0001-80', false],
    ['12.ABC.345/01DE-35', true],
    ['abc', false],
  ])('%s → %s', (doc, valid) => {
    expect(validDocument(doc)).toBe(valid);
  });

  it('formata para exibição', () => {
    expect(formatDocument('52998224725')).toBe('529.982.247-25');
    expect(formatDocument('11222333000181')).toBe('11.222.333/0001-81');
    expect(formatPhone('11987654321')).toBe('(11) 98765-4321');
    expect(formatPostalCode('01310100')).toBe('01310-100');
  });
});

describe('formulário de cliente', () => {
  const address = {
    postalCode: '01310-100',
    street: 'Avenida Paulista',
    number: '1000',
    district: 'Bela Vista',
    city: 'São Paulo',
    state: 'SP',
  };
  const parse = (v: Partial<typeof emptyCustomerForm>) =>
    customerFormSchema.safeParse({ ...emptyCustomerForm, ...address, ...v });

  it('nome e endereço são obrigatórios; CPF/CNPJ e complemento são opcionais', () => {
    expect(parse({ name: 'Mercado Bom Preço' }).success).toBe(true);
    expect(parse({ name: 'A' }).success).toBe(false);
    expect(parse({ name: '' }).success).toBe(false);
    const missing = customerFormSchema.safeParse({ ...emptyCustomerForm, name: 'Mercado' });
    expect(missing.success).toBe(false);
    expect(missing.error?.issues.map((i) => i.path[0])).toEqual(
      expect.arrayContaining(['postalCode', 'street', 'number', 'district', 'city', 'state']),
    );
  });

  it('"Sem número" dispensa o número', () => {
    expect(parse({ name: 'Mercado', number: '' }).success).toBe(false);
    expect(parse({ name: 'Mercado', number: '', noNumber: true }).success).toBe(true);
  });

  it('valida documento, e-mail, telefone, UF e CEP quando informados', () => {
    const r = parse({
      name: 'Mercado',
      document: '123',
      email: 'x@',
      phone: 'abc',
      state: 'SPX',
      postalCode: '123',
    });
    expect(r.success).toBe(false);
    const fields = r.error?.issues.map((i) => i.path[0]);
    expect(fields).toEqual(
      expect.arrayContaining(['document', 'email', 'phone', 'state', 'postalCode']),
    );
  });

  it('criação omite vazios e normaliza documento, CEP e UF', () => {
    const body = customerCreate({
      ...emptyCustomerForm,
      ...address,
      name: '  Mercado Bom Preço ',
      document: '529.982.247-25',
      state: 'sp',
      noNumber: true,
      number: '',
    });
    expect(body).toEqual({
      name: 'Mercado Bom Preço',
      document: '52998224725',
      address: {
        postalCode: '01310100',
        street: 'Avenida Paulista',
        number: 'S/N',
        district: 'Bela Vista',
        city: 'São Paulo',
        state: 'SP',
      },
    });
    expect(body).not.toHaveProperty('assignedTo');
  });

  it('edição envia null para limpar opcionais e nunca envia status ou responsável', () => {
    const body = customerUpdate({ ...emptyCustomerForm, ...address, name: 'Mercado' }, 3);
    expect(body).toEqual({
      expectedVersion: 3,
      name: 'Mercado',
      tradeName: null,
      document: null,
      email: null,
      phone: null,
      address: {
        postalCode: '01310100',
        street: 'Avenida Paulista',
        number: '1000',
        district: 'Bela Vista',
        city: 'São Paulo',
        state: 'SP',
      },
      notes: null,
    });
    expect(body).not.toHaveProperty('status');
    expect(body).not.toHaveProperty('assignedTo');
  });
});

describe('formulário de produto', () => {
  const parse = (v: Partial<typeof emptyProductForm>) =>
    productFormSchema.safeParse({ ...emptyProductForm, name: 'Café 500 g', sku: 'CAF-500', ...v });

  it('SKU segue o padrão do backend', () => {
    expect(parse({}).success).toBe(true);
    expect(parse({ sku: 'café 500' }).success).toBe(false);
    expect(parse({ sku: '-abc' }).success).toBe(false);
    expect(parse({ sku: 'a.b_c-1' }).success).toBe(true);
  });

  it('estoque mínimo respeita a precisão da unidade', () => {
    expect(parse({ unit: 'UN', minimumStock: '10' }).success).toBe(true);
    expect(parse({ unit: 'UN', minimumStock: '1,5' }).success).toBe(false);
    expect(parse({ unit: 'KG', minimumStock: '1,250' }).success).toBe(true);
    expect(parse({ unit: 'L', minimumStock: '0,0001' }).success).toBe(false);
  });

  it('preço em centavos inteiros dentro do limite', () => {
    expect(parse({ priceCents: 100_000_000 }).success).toBe(true);
    expect(parse({ priceCents: 100_000_001 }).success).toBe(false);
    expect(parse({ priceCents: -1 }).success).toBe(false);
  });

  it('criação converte o mínimo para o texto canônico da API', () => {
    const body = productCreate({
      ...emptyProductForm,
      name: 'Queijo',
      sku: 'QJ-1',
      unit: 'KG',
      priceCents: 4590,
      minimumStock: '1,5',
    });
    expect(body).toEqual({
      name: 'Queijo',
      sku: 'QJ-1',
      categoryId: null,
      unit: 'KG',
      priceCents: 4590,
      catalogVisible: false,
      minimumStock: '1.5',
    });
  });

  it('edição envia só o que mudou (evita UNIT_LOCKED sem necessidade)', () => {
    const p = product('p1', { unit: 'KG', quantityPrecision: 3, minimumStock: '2.5', version: 4 });
    const form = productToForm(p as never);
    expect(form.minimumStock).toBe('2,5');
    expect(productUpdate(form, p as never)).toEqual({ expectedVersion: 4 });
    expect(productUpdate({ ...form, priceCents: 2500 }, p as never)).toEqual({
      expectedVersion: 4,
      priceCents: 2500,
    });
  });
});
