// Validación de archivos subidos por firma binaria (magic bytes).
// La extensión que declara el cliente no es confiable: aquí se inspecciona el
// contenido real para impedir que se guarde HTML/scripts/ejecutables disfrazados
// de documento.

const startsWith = (buf: Buffer, bytes: number[], offset = 0): boolean => {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
};

/**
 * Devuelve la extensión canónica según el contenido real del archivo,
 * o null si el formato no es uno de los permitidos.
 */
export function sniffDocumentType(buf: Buffer): string | null {
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46])) return '.pdf'; // %PDF
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return '.jpg'; // JPEG
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47])) return '.png'; // PNG
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) return '.webp'; // RIFF....WEBP
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) return '.docx'; // ZIP (docx)
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0])) return '.doc'; // OLE2 (doc antiguo)
  return null;
}
