import { describe, it, expect } from 'vitest';

import { quitarMetadatosImagen } from './stripMetadata';

const b = (...partes: (number[] | string | Buffer)[]) =>
  Buffer.concat(partes.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))));

// Segmento JPEG: FF <marcador> <longitud BE incluyendo los 2 bytes> <datos>
const seg = (marcador: number, datos: string) => {
  const d = Buffer.from(datos, 'latin1');
  return b([0xff, marcador, (d.length + 2) >> 8, (d.length + 2) & 0xff], d);
};

describe('quitarMetadatosImagen: JPEG', () => {
  const app0 = seg(0xe0, 'JFIF\0');
  const icc = seg(0xe2, 'ICC_PROFILE\0');
  const scan = b([0xff, 0xda, 0x00, 0x02], [0x12, 0xff, 0x00, 0x34], [0xff, 0xd9]);
  const jpeg = b([0xff, 0xd8], app0, seg(0xe1, 'Exif\0\0GPS-19.43'), icc, seg(0xed, 'Photoshop 3.0'), seg(0xfe, 'comentario'), scan);

  it('quita APP1/APP13/COM y conserva APP0, ICC y el scan', () => {
    const limpio = quitarMetadatosImagen(jpeg, 'image/jpeg');
    expect(limpio).toEqual(b([0xff, 0xd8], app0, icc, scan));
    expect(limpio.includes('GPS')).toBe(false);
  });

  it('devuelve el original si está mal formado', () => {
    const roto = b([0xff, 0xd8], [0xff, 0xe1, 0xff, 0xff], 'Exif');
    expect(quitarMetadatosImagen(roto, '.jpg')).toBe(roto);
  });
});

describe('quitarMetadatosImagen: PNG', () => {
  // CRC falso: el limpiador no lo recalcula, copia el chunk entero.
  const chunk = (tipo: string, datos: string) => {
    const d = Buffer.from(datos, 'latin1');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(d.length);
    return b(len, tipo, d, [1, 2, 3, 4]);
  };
  const firma = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = chunk('IHDR', '0123456789abc');
  const idat = chunk('IDAT', 'pixeles');
  const iend = chunk('IEND', '');

  it('quita eXIf/tEXt/zTXt/iTXt/tIME y conserva el resto', () => {
    const png = b(firma, ihdr, chunk('eXIf', 'GPS'), chunk('tEXt', 'Autor'), chunk('tIME', '1234567'), idat, chunk('iTXt', 'x'), chunk('zTXt', 'y'), iend);
    expect(quitarMetadatosImagen(png, '.png')).toEqual(b(firma, ihdr, idat, iend));
  });
});

describe('quitarMetadatosImagen: WebP', () => {
  const chunk = (tipo: string, datos: Buffer | string) => {
    const d = typeof datos === 'string' ? Buffer.from(datos, 'latin1') : datos;
    const len = Buffer.alloc(4);
    len.writeUInt32LE(d.length);
    return b(tipo, len, d, d.length % 2 ? [0] : []);
  };
  const riff = (cuerpo: Buffer) => {
    const size = Buffer.alloc(4);
    size.writeUInt32LE(cuerpo.length + 4);
    return b('RIFF', size, 'WEBP', cuerpo);
  };
  const vp8x = (flags: number) => chunk('VP8X', b([flags, 0, 0, 0, 1, 0, 0, 1, 0, 0]));
  const vp8 = chunk('VP8 ', 'datos-de-imagen');

  it('quita EXIF/XMP, corrige el tamaño RIFF y apaga las banderas de VP8X', () => {
    const webp = riff(b(vp8x(0x20 | 0x08 | 0x04), vp8, chunk('EXIF', 'GPS'), chunk('XMP ', '<x/>')));
    const limpio = quitarMetadatosImagen(webp, 'image/webp');
    expect(limpio).toEqual(riff(b(vp8x(0x20), vp8)));
    expect(limpio.readUInt32LE(4)).toBe(limpio.length - 8);
  });
});

describe('quitarMetadatosImagen: otros', () => {
  it('no toca PDFs', () => {
    const pdf = Buffer.from('%PDF-1.4 /Author (x)');
    expect(quitarMetadatosImagen(pdf, '.pdf')).toBe(pdf);
  });
});
