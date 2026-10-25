import { fireEvent, screen, waitFor } from 'expo-router/testing-library';
import * as ImagePicker from 'expo-image-picker';
import CompanySettings from '@/app/(app)/configuracoes/empresa';
import ProductDetail from '@/app/(app)/produtos/[id]/index';
import NewProduct from '@/app/(app)/produtos/novo';
import Title from '@/app/(app)/financeiro/[id]';
import { ApiError, waitText } from '@/api/errors';
import { imageFailure, sniffImageType } from '@/lib/imageFiles';
import { intentLedger } from '@/lib/intent';
import {
  category,
  createFakeApi,
  fail,
  membership,
  ok,
  page,
  product,
  tenant,
} from '../support/fakeApi';
import { financialState, method, receivable } from '../support/financeFixtures';
import { FakeGateway } from '../support/fakeGateway';
import { renderApp } from '../support/renderApp';

jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
const pick = ImagePicker.launchImageLibraryAsync as jest.Mock;
const realFetch = globalThis.fetch;
const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
/** The picker hands a local file; fetch(uri) reads it as a Blob. */
function pickFile(bytes: Uint8Array<ArrayBuffer>, mimeType: string, uri = 'file:///foto.png') {
  pick.mockResolvedValue({
    canceled: false,
    assets: [{ uri, mimeType, fileSize: bytes.byteLength }],
  });
  globalThis.fetch = jest.fn(async () => ({
    blob: async () => new Blob([bytes], { type: mimeType }),
  })) as never;
}
afterEach(() => {
  globalThis.fetch = realFetch;
  pick.mockReset();
  intentLedger.reset();
});

const overrides = {
  '(app)/configuracoes/empresa': CompanySettings,
  '(app)/produtos/novo': NewProduct,
  '(app)/produtos/[id]/index': ProductDetail,
  '(app)/financeiro/[id]': Title,
};
function world(role: 'administrator' | 'seller' = 'administrator', permissions?: string[]) {
  const gateway = new FakeGateway({
    initialUser: { uid: 'u1', email: 'ana@lastro.test', emailVerified: true },
  });
  const m = membership('t1', role);
  let company = tenant('t1', 'Empresa A') as ReturnType<typeof tenant> & { logo: unknown };
  const server = createFakeApi()
    .on('GET', '/api/v1/me', () =>
      ok({
        uid: 'u1',
        email: 'ana@lastro.test',
        platformAdmin: false,
        memberships: [{ ...m, ...(permissions ? { permissions } : {}) }],
      }),
    )
    .on('GET', '/api/v1/tenants/current', () => ok(company))
    .on('GET', '/api/v1/categories', () => ok(page([category('cat1', { name: 'Tintas' })])));
  return {
    gateway,
    server,
    setCompany: (next: Partial<typeof company>) => (company = { ...company, ...next }),
  };
}

describe('Empresa: nome e logotipo', () => {
  it('administrador renomeia a empresa com a versão atual', async () => {
    const { gateway, server, setCompany } = world();
    let sent: unknown;
    server.on('PATCH', '/api/v1/tenants/current', (c) => {
      sent = c.body;
      setCompany({ name: 'Lady Pets Distribuidora', version: 2 });
      return ok({ ...tenant('t1', 'Lady Pets Distribuidora'), logo: null, version: 2 });
    });
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/configuracoes/empresa',
      overrides,
    });
    const field = await screen.findByLabelText('Nome da empresa');
    expect(screen.getByRole('button', { name: 'Salvar nome' })).toBeDisabled();
    await fireEvent.changeText(field, '  Lady Pets Distribuidora ');
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar nome' }));
    await waitFor(() =>
      expect(sent).toEqual({ name: 'Lady Pets Distribuidora', expectedVersion: 1 }),
    );
    // Saved: the field shows the stored name and there is nothing left to save.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar nome' })).toBeDisabled());
    expect(screen.getByDisplayValue('Lady Pets Distribuidora')).toBeTruthy();
    expect(screen.queryByText('Nome não salvo')).toBeNull();
  });
  it('erro ao salvar o nome fica visível na tela', async () => {
    const { gateway, server } = world();
    server.on('PATCH', '/api/v1/tenants/current', () => fail(409, 'CONFLICT'));
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/configuracoes/empresa',
      overrides,
    });
    await fireEvent.changeText(await screen.findByLabelText('Nome da empresa'), 'Outro nome');
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar nome' }));
    expect(await screen.findByText('Nome não salvo')).toBeTruthy();
  });
  it('remover o logotipo apaga o aviso de um envio recusado antes', async () => {
    const { gateway, server } = world();
    const stored = { id: 'l1', contentType: 'image/webp', sizeBytes: 10, width: 10, height: 10 };
    let company = { ...tenant('t1', 'Empresa A'), logo: stored as typeof stored | null };
    server
      .on('GET', '/api/v1/tenants/current', () => ok(company))
      .on('GET', '/api/v1/tenants/current/logo', () => ({ status: 200, body: undefined }))
      .on('PUT', '/api/v1/tenants/current/logo', () => fail(422, 'UNSUPPORTED_IMAGE_FORMAT'))
      .on('DELETE', '/api/v1/tenants/current/logo', () => {
        company = { ...company, logo: null, version: 2 };
        return ok(company);
      });
    pickFile(pngBytes, 'image/png');
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/configuracoes/empresa',
      overrides,
    });
    await fireEvent.press(await screen.findByRole('button', { name: 'Substituir' }));
    expect(await screen.findByText('Logotipo não salvo')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Remover' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Remover logotipo' }));
    expect(await screen.findByRole('button', { name: 'Adicionar logotipo' })).toBeTruthy();
    expect(screen.queryByText('Logotipo não salvo')).toBeNull();
  });
  it('vendedor vê os dados sem campos de edição', async () => {
    const { gateway, server } = world('seller');
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/configuracoes/empresa',
      overrides,
    });
    expect(await screen.findByText('Empresa A')).toBeTruthy();
    expect(screen.queryByLabelText('Nome da empresa')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Adicionar logotipo' })).toBeNull();
    expect(server.calls.some((c) => c.method !== 'GET')).toBe(false);
  });
  it('envia o logotipo com o formato real e mostra recusa do servidor', async () => {
    const { gateway, server } = world();
    let uploads = 0;
    server.on('PUT', '/api/v1/tenants/current/logo', (c) => {
      uploads++;
      // Declared JPEG, real PNG: the signature decides the Content-Type.
      expect(c.headers['content-type']).toBe('image/png');
      expect(c.query).toEqual({ expectedVersion: '1' });
      return uploads === 1
        ? fail(500, 'INTERNAL_ERROR')
        : ok({
            ...tenant('t1', 'Empresa A'),
            version: 2,
            logo: { id: 'l1', contentType: 'image/webp', sizeBytes: 10, width: 10, height: 10 },
          });
    });
    pickFile(pngBytes, 'image/jpeg', 'file:///logo.jpg');
    await renderApp({
      gateway,
      fetch: server.fetch,
      initialUrl: '/configuracoes/empresa',
      overrides,
    });
    await fireEvent.press(await screen.findByRole('button', { name: 'Adicionar logotipo' }));
    expect(await screen.findByText('Logotipo não salvo')).toBeTruthy();
    expect(screen.getByText(/Erro interno ao salvar a imagem/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('button', { name: 'Substituir' })).toBeTruthy();
    expect(screen.queryByText('Logotipo não salvo')).toBeNull();
    expect(uploads).toBe(2);
  });
});

describe('Produtos: imagem que falha depois do cadastro', () => {
  async function fill() {
    await fireEvent.changeText(await screen.findByLabelText('Nome do produto'), 'Drean Color Azul');
    await fireEvent.changeText(screen.getByLabelText('SKU'), 'DREAN-AZ');
  }
  it('produto fica salvo, o erro não some e "Tentar de novo" envia a mesma foto', async () => {
    const { gateway, server } = world();
    let creates = 0,
      uploads = 0;
    server
      .on('POST', '/api/v1/products', () => {
        creates++;
        return ok(product('p9', { name: 'Drean Color Azul', sku: 'DREAN-AZ' }), 201);
      })
      .on('PUT', '/api/v1/products/p9/image', () => {
        uploads++;
        return uploads === 1
          ? fail(500, 'INTERNAL_ERROR')
          : ok(
              product('p9', {
                name: 'Drean Color Azul',
                version: 2,
                image: { id: 'i1', contentType: 'image/webp', sizeBytes: 9, width: 9, height: 9 },
              }),
            );
      })
      .on('GET', '/api/v1/products/p9', () => ok(product('p9', { name: 'Drean Color Azul' })))
      .on('GET', '/api/v1/products/p9/image', () => ({ status: 200, body: undefined }));
    pickFile(pngBytes, 'image/png');
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/produtos/novo', overrides });
    await fill();
    await fireEvent.press(screen.getByRole('button', { name: 'Adicionar imagem' }));
    await screen.findByText('Enviada ao salvar o produto.');
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar produto' }));
    expect(await screen.findByText('Produto "Drean Color Azul" cadastrado')).toBeTruthy();
    expect(screen.getByText('A imagem não foi salva')).toBeTruthy();
    expect(screen.getByText(/Erro interno ao salvar a imagem/)).toBeTruthy();
    // The form is gone: saving again cannot create a duplicate.
    expect(screen.queryByRole('button', { name: 'Salvar produto' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('header', { name: 'Drean Color Azul' })).toBeTruthy();
    expect([creates, uploads]).toEqual([1, 2]);
  });
  it('arquivo recusado oferece escolher outra imagem ou seguir sem ela', async () => {
    const { gateway, server } = world();
    server
      .on('POST', '/api/v1/products', () => ok(product('p9', { name: 'Drean Color Azul' }), 201))
      .on('PUT', '/api/v1/products/p9/image', () => fail(422, 'UNSUPPORTED_IMAGE_FORMAT'))
      .on('GET', '/api/v1/products/p9', () => ok(product('p9', { name: 'Drean Color Azul' })));
    pickFile(pngBytes, 'image/png');
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/produtos/novo', overrides });
    await fill();
    await fireEvent.press(screen.getByRole('button', { name: 'Adicionar imagem' }));
    await screen.findByText('Enviada ao salvar o produto.');
    await fireEvent.press(screen.getByRole('button', { name: 'Salvar produto' }));
    expect(await screen.findByText(/Formato incompatível/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Escolher outra imagem' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Continuar sem imagem' }));
    expect(await screen.findByRole('header', { name: 'Drean Color Azul' })).toBeTruthy();
  });
  it('falha de conexão na ficha do produto mostra o motivo e permite repetir', async () => {
    const { gateway, server } = world();
    server.on('GET', '/api/v1/products/p1', () => ok(product('p1')));
    // No PUT route: the fake network rejects like a dropped connection.
    pickFile(pngBytes, 'image/png');
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/produtos/p1', overrides });
    await fireEvent.press(await screen.findByRole('button', { name: 'Adicionar imagem' }));
    expect(await screen.findByText(/Problema de conexão/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
    expect(screen.getByLabelText('Sem imagem')).toBeTruthy();
  });
});

describe('Mensagens de imagem', () => {
  it('explica cada tipo de falha e quando repetir', () => {
    expect(imageFailure(new ApiError(413, 'VALIDATION_ERROR', 'x'))).toMatchObject({
      retryable: false,
    });
    expect(imageFailure(new ApiError(413, 'IMAGE_TOO_LARGE', 'x')).message).toMatch(/5 MB/);
    expect(imageFailure(new ApiError(422, 'INVALID_IMAGE', 'x')).message).toMatch(/corrompida/);
    expect(imageFailure(new ApiError(422, 'IMAGE_RESOLUTION_LIMIT', 'x')).message).toMatch(
      /50 megapixels/,
    );
    const limited = imageFailure(new ApiError(429, 'RATE_LIMITED', 'x', undefined, 1500));
    expect(limited).toEqual({
      message: 'Limite de envios de imagens desta hora atingido. Tente de novo em 25 min.',
      retryable: true,
    });
    expect(imageFailure(new ApiError(0, 'NETWORK_ERROR', 'x')).retryable).toBe(true);
    expect(imageFailure(new ApiError(500, 'INTERNAL_ERROR', 'x')).message).toMatch(/Erro interno/);
    expect(waitText(3900)).toBe('1 h 5 min');
    expect(new ApiError(429, 'RATE_LIMITED', 'x', undefined, 1200).userMessage).toBe(
      'Limite de tentativas atingido. Tente de novo em 20 min.',
    );
  });
  it('reconhece o formato pela assinatura do arquivo', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const webp = new Uint8Array(
      [...'RIFF']
        .map((c) => c.charCodeAt(0))
        .concat(
          [0, 0, 0, 0],
          [...'WEBP'].map((c) => c.charCodeAt(0)),
        ),
    );
    expect(await sniffImageType(new Blob([jpeg]))).toBe('image/jpeg');
    expect(await sniffImageType(new Blob([pngBytes]))).toBe('image/png');
    expect(await sniffImageType(new Blob([webp]))).toBe('image/webp');
    expect(await sniffImageType(new Blob([new Uint8Array(12)]))).toBeNull();
  });
});

describe('Financeiro: correção de vencimento', () => {
  function finance(role: 'administrator' | 'seller' = 'administrator', permissions?: string[]) {
    const w = world(role, permissions);
    w.server
      .on('GET', '/api/v1/receivables/r1', () => ok(receivable()))
      .on('GET', '/api/v1/orders/o1/financial-state', () => ok(financialState()))
      .on('GET', '/api/v1/payments', () => ok(page([])))
      .on('GET', '/api/v1/orders/o1/financial-history', () => ok(page([])))
      .on('GET', '/api/v1/financial-executions', () => ok(page([])))
      .on('GET', '/api/v1/receivables/r1/due-date-changes', () => ok({ items: [] }))
      .on('GET', '/api/v1/orders/payment-options/methods', () => ok(page([method])));
    return w;
  }
  it('administrador escolhe a data, informa o motivo e confirma', async () => {
    const { gateway, server } = finance();
    let sent: { headers: Record<string, string>; body: unknown } | null = null;
    server.on('POST', '/api/v1/orders/o1/due-date-changes', (c) => {
      sent = { headers: c.headers, body: c.body };
      return ok({
        change: {
          id: 'chg1',
          orderId: 'o1',
          customerId: 'c1',
          receivableId: 'r1',
          installmentNumber: 1,
          previousDueDate: '2026-10-01',
          dueDate: '2099-11-03',
          reason: 'Combinado com a Lá Vet',
          orderVersion: 5,
          actorUid: 'u1',
          requestId: '00000000-0000-4000-8000-000000000000',
          occurredAt: '2026-10-25T12:00:00.000Z',
        },
        orderVersion: 5,
        guardVersion: 7,
      });
    });
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/financeiro/r1', overrides });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Alterar vencimento' })).toBeEnabled(),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Alterar vencimento' }));
    await fireEvent.changeText(await screen.findByLabelText('Novo vencimento'), '03/11/2099');
    await fireEvent.changeText(screen.getByLabelText('Motivo'), 'Combinado com a Lá Vet');
    await fireEvent.press(screen.getByRole('button', { name: 'Confirmar 03/11/2099' }));
    expect(await screen.findByText('Vencimento alterado')).toBeTruthy();
    expect(screen.getByText(/De 01\/10\/2026 para 03\/11\/2099/)).toBeTruthy();
    expect(sent!.body).toEqual({
      expectedOrderVersion: 4,
      expectedGuardVersion: 7,
      receivableId: 'r1',
      expectedVersion: 3,
      dueDate: '2099-11-03',
      reason: 'Combinado com a Lá Vet',
    });
    expect(sent!.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('recusa do servidor aparece no diálogo sem fechar', async () => {
    const { gateway, server } = finance();
    server.on('POST', '/api/v1/orders/o1/due-date-changes', () => fail(409, 'DUE_DATE_LOCKED'));
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/financeiro/r1', overrides });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Alterar vencimento' })).toBeEnabled(),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Alterar vencimento' }));
    await fireEvent.changeText(await screen.findByLabelText('Novo vencimento'), '03/11/2099');
    await fireEvent.press(screen.getByRole('button', { name: 'Confirmar 03/11/2099' }));
    expect(await screen.findByText('Explique o motivo em poucas palavras.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Motivo'), 'Combinado');
    await fireEvent.press(screen.getByRole('button', { name: 'Confirmar 03/11/2099' }));
    expect(await screen.findByText('Vencimento não alterado')).toBeTruthy();
    expect(screen.getByText(/já foi quitada, cancelada/)).toBeTruthy();
  });
  it('sem receivables:manage não há ação; parcela quitada fica bloqueada', async () => {
    const admin = membership('t1', 'administrator').permissions.filter(
      (p) => p !== 'receivables:manage',
    );
    const a = finance('administrator', admin);
    await renderApp({
      gateway: a.gateway,
      fetch: a.server.fetch,
      initialUrl: '/financeiro/r1',
      overrides,
    });
    await screen.findByText('Saldo a receber');
    expect(screen.queryByRole('button', { name: 'Alterar vencimento' })).toBeNull();
  });
  it('parcela quitada não oferece alteração', async () => {
    const paid = receivable({ outstandingCents: 0, cashCents: 2000, status: 'paid' });
    const { gateway, server } = finance();
    server
      .on('GET', '/api/v1/receivables/r1', () => ok(paid))
      .on('GET', '/api/v1/orders/o1/financial-state', () =>
        ok(financialState([paid], { cashReceivedCents: 2000, cashSettledCents: 2000 })),
      );
    await renderApp({ gateway, fetch: server.fetch, initialUrl: '/financeiro/r1', overrides });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Alterar vencimento' })).toBeDisabled(),
    );
  });
});
