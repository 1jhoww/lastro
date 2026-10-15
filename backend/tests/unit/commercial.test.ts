import { describe, it, expect } from 'vitest';
import { validDocument, normalizeDocument } from '../../src/modules/customers/documents.js';
import * as s from '../../src/shared/schemas/commercial.js';
import { normalizeImage } from '../../src/modules/products/imageService.js';
import sharp from 'sharp';
describe('Documentos e valores comerciais', () => {
  it.each(['529.982.247-25', '11222333000181', '12.ABC.345/01DE-35'])(
    'valida documento sintético/oficial de formato %s',
    (value) => expect(validDocument(value)).toBe(true),
  );
  it.each([
    '00000000000',
    '11111111111',
    '00000000000000',
    '52998224724',
    '12ABC34501DE34',
    '529x98224725',
    '123',
    'ABCDEFGHIJKLMN',
  ])('rejeita %s', (value) => expect(validDocument(value)).toBe(false));
  it('normaliza sem apagar caracteres inesperados', () => {
    expect(normalizeDocument(' 12.abc.345/01de-35 ')).toBe('12ABC34501DE35');
    expect(s.sku.parse(' abc-01 ')).toBe('ABC-01');
    expect(s.customerCreate.parse({ name: ' Exemplo ', phone: '(11) 99999-0000' }).phone).toBe(
      '11999990000',
    );
    expect(s.customerCreate.safeParse({ name: 'Exemplo', address: {} }).success).toBe(true);
  });
  it.each([-1, 0.5, 100_000_001])('rejeita preço %s', (priceCents) =>
    expect(
      s.productCreate.safeParse({ name: 'Exemplo', sku: 'EX', unit: 'UN', priceCents }).success,
    ).toBe(false),
  );
  it('define precisão futura sem conversões', () => {
    expect(['UN', 'CX', 'PCT', 'KG', 'L'].map((v) => s.quantityPrecision(s.unit.parse(v)))).toEqual(
      [0, 0, 0, 3, 3],
    );
  });
});
describe('Conteúdo de imagem', () => {
  it('decodifica e recodifica raster para WebP sem metadados', async () => {
    const source = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#123456' },
    })
      .jpeg()
      .toBuffer();
    const image = await normalizeImage(source, 'image/jpeg');
    expect((await sharp(image.data).metadata()).format).toBe('webp');
    expect(image.width).toBe(2);
  });
  it('rejeita MIME diferente, SVG, conteúdo corrompido e buffer vazio', async () => {
    const source = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#123456' },
    })
      .png()
      .toBuffer();
    for (const [data, type] of [
      [source, 'image/jpeg'],
      [Buffer.from('<svg/>'), 'image/svg+xml'],
      [source.subarray(0, 32), 'image/png'],
      [Buffer.alloc(0), 'image/png'],
    ] as const)
      await expect(normalizeImage(data, type)).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
  });
  it('limita bytes e pixels decodificados', async () => {
    await expect(
      normalizeImage(Buffer.alloc(5 * 1024 * 1024 + 1), 'image/png'),
    ).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
    const large = await sharp({
      create: { width: 4097, height: 4097, channels: 3, background: '#123456' },
    })
      .png()
      .toBuffer();
    await expect(normalizeImage(large, 'image/png')).rejects.toMatchObject({
      code: 'INVALID_IMAGE',
    });
  });
});
