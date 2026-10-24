/**
 * Quita metadatos (EXIF con GPS, XMP, IPTC, comentarios, textos) de imágenes
 * subidas: una foto de INE tomada con el celular puede traer la ubicación de
 * la casa del candidato. Solo se descartan bloques de metadatos; los datos de
 * la imagen se copian intactos (sin recomprimir). Ante cualquier estructura
 * rara se devuelve el buffer original: nunca rompe una subida.
 *
 * `tipo` acepta mime ('image/jpeg') o extensión ('.jpg'). PDF y demás: sin cambios.
 */
export function quitarMetadatosImagen(buffer: Buffer, tipo: string): Buffer {
  const t = tipo.toLowerCase().replace(/^image\//, '').replace(/^\./, '');
  try {
    if (t === 'jpeg' || t === 'jpg') return limpiarJpeg(buffer) ?? buffer;
    if (t === 'png') return limpiarPng(buffer) ?? buffer;
    if (t === 'webp') return limpiarWebp(buffer) ?? buffer;
  } catch {
    // estructura inesperada: se guarda tal cual
  }
  return buffer;
}

// APP1 (Exif/XMP), APP13 (IPTC/Photoshop), COM. Se conservan APP0, APP2 (ICC), etc.
const JPEG_DESCARTAR = new Set([0xe1, 0xed, 0xfe]);

function limpiarJpeg(buf: Buffer): Buffer | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const partes: Buffer[] = [buf.subarray(0, 2)];
  let pos = 2;
  while (pos < buf.length) {
    if (buf[pos] !== 0xff) return null;
    let m = pos + 1;
    while (buf[m] === 0xff) m++; // bytes de relleno
    const marcador = buf[m];
    if (marcador === undefined) return null;
    // SOS o EOI: lo que sigue son datos de imagen, se copia sin tocar.
    if (marcador === 0xda || marcador === 0xd9) {
      partes.push(buf.subarray(pos));
      return Buffer.concat(partes);
    }
    // Marcadores sin longitud (TEM, RSTn).
    if (marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd7)) {
      partes.push(buf.subarray(pos, m + 1));
      pos = m + 1;
      continue;
    }
    if (m + 3 > buf.length) return null;
    const len = buf.readUInt16BE(m + 1);
    const fin = m + 1 + len;
    if (len < 2 || fin > buf.length) return null;
    if (!JPEG_DESCARTAR.has(marcador)) partes.push(buf.subarray(pos, fin));
    pos = fin;
  }
  return null; // sin SOS: no es un JPEG completo
}

const PNG_FIRMA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DESCARTAR = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

function limpiarPng(buf: Buffer): Buffer | null {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_FIRMA)) return null;
  const partes: Buffer[] = [PNG_FIRMA];
  let pos = 8;
  while (pos < buf.length) {
    if (pos + 12 > buf.length) return null;
    const len = buf.readUInt32BE(pos);
    const tipo = buf.toString('latin1', pos + 4, pos + 8);
    const fin = pos + 12 + len; // longitud + tipo + datos + CRC
    if (fin > buf.length) return null;
    // Se copia el chunk entero, así el CRC sigue siendo válido.
    if (!PNG_DESCARTAR.has(tipo)) partes.push(buf.subarray(pos, fin));
    pos = fin;
    if (tipo === 'IEND') {
      partes.push(buf.subarray(pos));
      break;
    }
  }
  return Buffer.concat(partes);
}

function limpiarWebp(buf: Buffer): Buffer | null {
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return null;
  const partes: Buffer[] = [];
  let pos = 12;
  while (pos < buf.length) {
    if (pos + 8 > buf.length) return null;
    const tipo = buf.toString('latin1', pos, pos + 4);
    const len = buf.readUInt32LE(pos + 4);
    const fin = Math.min(pos + 8 + len + (len & 1), buf.length); // relleno a par
    if (pos + 8 + len > buf.length) return null;
    if (tipo !== 'EXIF' && tipo !== 'XMP ') {
      const chunk = Buffer.from(buf.subarray(pos, fin));
      // VP8X declara en sus banderas si hay EXIF (0x08) y XMP (0x04): se apagan.
      if (tipo === 'VP8X' && len >= 1) chunk[8] &= ~0x0c;
      partes.push(chunk);
    }
    pos = fin;
  }
  const cuerpo = Buffer.concat(partes);
  const cabecera = Buffer.from('RIFF\0\0\0\0WEBP', 'latin1');
  cabecera.writeUInt32LE(cuerpo.length + 4, 4);
  return Buffer.concat([cabecera, cuerpo]);
}
