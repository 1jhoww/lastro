import { describe, it, expect } from 'vitest';
import { validDocument, normalizeDocument } from '../../src/modules/customers/documents.js';
import * as s from '../../src/shared/schemas/commercial.js';
import { normalizeImage, sniffImage } from '../../src/modules/products/imageService.js';
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
    const address = {
      postalCode: '01310-100',
      street: 'Avenida Paulista',
      number: 'S/N',
      district: 'Bela Vista',
      city: 'São Paulo',
      state: 'sp',
    };
    expect(normalizeDocument(' 12.abc.345/01de-35 ')).toBe('12ABC34501DE35');
    expect(s.sku.parse(' abc-01 ')).toBe('ABC-01');
    expect(
      s.customerCreate.parse({ name: ' Exemplo ', phone: '(11) 99999-0000', address }).phone,
    ).toBe('11999990000');
    expect(s.customerCreate.safeParse({ name: 'Exemplo', address: {} }).success).toBe(false);
    expect(s.customerUpdate.safeParse({ expectedVersion: 1, address: null }).success).toBe(false);
    expect(s.customerUpdate.safeParse({ expectedVersion: 1, status: 'active' }).success).toBe(true);
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
  it('decide o formato pela assinatura do arquivo, não pelo rótulo declarado', async () => {
    const create = { width: 2, height: 2, channels: 3, background: '#123456' } as const;
    const png = await sharp({ create }).png().toBuffer();
    const webp = await sharp({ create }).webp().toBuffer();
    const jpeg = await sharp({ create }).jpeg().toBuffer();
    expect([sniffImage(png), sniffImage(webp), sniffImage(jpeg)]).toEqual(['png', 'webp', 'jpeg']);
    // A ".jpg" that is really WebP or PNG (supplier catalogs) is still a valid photo.
    for (const [data, type] of [
      [webp, 'image/jpeg'],
      [png, 'image/jpeg'],
      [jpeg, 'application/octet-stream'],
      [jpeg, 'image/jpeg; charset=binary'],
    ] as const)
      expect((await sharp((await normalizeImage(data, type)).data).metadata()).format).toBe('webp');
  });
  it('rejeita SVG, GIF, tipos não-imagem, conteúdo corrompido e buffer vazio', async () => {
    const create = { width: 2, height: 2, channels: 3, background: '#123456' } as const;
    const source = await sharp({ create }).png().toBuffer();
    const gif = await sharp({ create }).gif().toBuffer();
    for (const [data, type, code] of [
      [Buffer.from('<svg/>'), 'image/svg+xml', 'UNSUPPORTED_IMAGE_FORMAT'],
      [Buffer.from('<svg/>'), 'image/png', 'UNSUPPORTED_IMAGE_FORMAT'],
      [gif, 'image/gif', 'UNSUPPORTED_IMAGE_FORMAT'],
      [source, 'image/svg+xml', 'UNSUPPORTED_IMAGE_FORMAT'],
      [source, 'text/plain', 'UNSUPPORTED_IMAGE_FORMAT'],
      [source, undefined, 'UNSUPPORTED_IMAGE_FORMAT'],
      [source.subarray(0, 32), 'image/png', 'INVALID_IMAGE'],
      [Buffer.alloc(0), 'image/png', 'INVALID_IMAGE'],
    ] as const)
      await expect(normalizeImage(data, type)).rejects.toMatchObject({ code });
  });
  it('limita bytes e resolução, e reduz fotos grandes sem rejeitá-las', async () => {
    await expect(
      normalizeImage(Buffer.alloc(5 * 1024 * 1024 + 1), 'image/png'),
    ).rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE', status: 413 });
    const wide = await sharp({
      create: { width: 12_001, height: 2, channels: 3, background: '#123456' },
    })
      .png()
      .toBuffer();
    await expect(normalizeImage(wide, 'image/png')).rejects.toMatchObject({
      code: 'IMAGE_RESOLUTION_LIMIT',
    });
    // 16.8 MP was refused before; it is now accepted and stored at catalog size.
    const large = await sharp({
      create: { width: 4097, height: 4097, channels: 3, background: '#123456' },
    })
      .png()
      .toBuffer();
    const stored = await normalizeImage(large, 'image/png');
    expect([stored.width, stored.height]).toEqual([2048, 2048]);
    expect((await normalizeImage(large, 'image/png', 1024)).width).toBe(1024);
  });
  it('aceita JPEG com avisos menores do codificador e preserva transparência', async () => {
    const jpeg = await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#123456' },
    })
      .jpeg()
      .toBuffer();
    // Extra bytes after the end marker are a classic libjpeg warning, not a broken image.
    const quirky = Buffer.concat([jpeg, Buffer.from([0x00, 0x00, 0x00, 0x00])]);
    await expect(normalizeImage(quirky, 'image/jpeg')).resolves.toMatchObject({ width: 4 });
    const transparent = await sharp({
      create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const stored = await normalizeImage(transparent, 'image/png');
    expect((await sharp(stored.data).metadata()).hasAlpha).toBe(true);
  });
});
