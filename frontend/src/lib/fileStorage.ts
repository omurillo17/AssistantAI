import { unlink } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';

export const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');

/**
 * Borra un archivo previamente subido por un candidato (CV/INE/RFC), dado
 * el valor guardado en BD (ej. candidatos.link_cv, o datos_ine->>'url').
 * Solo borra rutas dentro de /uploads/ (nunca sigue rutas absolutas o fuera
 * del directorio de subidas) y nunca lanza si el archivo ya no existe.
 */
export async function deleteUploadedFile(url: string | null | undefined): Promise<void> {
  if (!url || typeof url !== 'string' || !url.startsWith('/uploads/')) return;
  try {
    const filename = path.basename(url);
    const fullPath = path.join(UPLOAD_DIR, filename);
    if (fs.existsSync(fullPath)) {
      await unlink(fullPath);
    }
  } catch (e) {
    console.warn('No se pudo eliminar el archivo:', url, e);
  }
}

/** Extrae la url de un campo datos_ine/datos_rfc que puede venir como JSON string, objeto, o null. */
export function extractFileUrl(value: unknown): string | null {
  if (!value) return null;
  try {
    const obj = typeof value === 'string' ? JSON.parse(value) : value;
    return (obj && typeof obj === 'object' && typeof (obj as Record<string, unknown>).url === 'string')
      ? (obj as Record<string, unknown>).url as string
      : null;
  } catch {
    return null;
  }
}
