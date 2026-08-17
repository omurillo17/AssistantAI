#!/usr/bin/env python3
"""
Script: migrar_lids_duplicados.py
Descripción:
  1. Busca en la tabla 'candidatos' todos los registros guardados con un LID (identificador provisional de WhatsApp).
  2. Consulta la API de WAHA (contactos y chats) para resolver el número telefónico real.
  3. Si el número real YA existe en la BD:
     - Fusiona el historial y datos del expediente (conservando el más completo/reciente).
     - Reasigna 'conversation_history' y 'mensajes_bandeja' al registro real.
     - ELIMINA el registro duplicado con LID de la tabla 'candidatos'.
  4. Si el número real NO existía aún:
     - Actualiza el teléfono del registro del LID a su número real.
     - Actualiza el historial asociado.

Uso:
  # Modo simulación (no modifica nada):
  docker compose exec backend python3 /app/scripts/migrar_lids_duplicados.py --dry-run

  # Modo aplicación real:
  docker compose exec backend python3 /app/scripts/migrar_lids_duplicados.py --apply
"""

import argparse
import asyncio
import os
import sys
import httpx
import asyncpg


def clean_phone(phone_raw: str | None) -> str:
    if not phone_raw:
        return ""
    if "@" in phone_raw:
        phone_raw = phone_raw.split("@")[0]
    digits = "".join(filter(str.isdigit, phone_raw))
    if len(digits) >= 10 and (digits.startswith("52") or len(digits) == 10 or len(digits) == 12 or len(digits) == 13):
        return digits
    return ""


async def fetch_waha_chats_mapping(waha_url: str, api_key: str, session: str = "default") -> dict[str, str]:
    """Crea un mapa accountLid -> número telefónico a partir de todos los chats de WAHA."""
    headers = {"X-Api-Key": api_key}
    mapping: dict[str, str] = {}
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(f"{waha_url}/api/{session}/chats", headers=headers, params={"limit": 10000})
            if resp.status_code != 200:
                resp = await client.get(f"{waha_url}/api/chats", headers=headers, params={"limit": 10000, "session": session})
            if resp.status_code == 200:
                chats = resp.json()
                for c in chats if isinstance(chats, list) else []:
                    account_lid = c.get("accountLid") or ""
                    if "@lid" in account_lid:
                        lid_num = account_lid.split("@")[0]
                        cid = c.get("id") or ""
                        pn = c.get("pnJid") or ""
                        phone_src = cid if ("@s.whatsapp.net" in cid or "@c.us" in cid) else pn
                        phone_clean = clean_phone(phone_src)
                        if phone_clean and len(phone_clean) <= 13:
                            mapping[lid_num] = phone_clean
    except Exception as e:
        print(f"[AVISO] No se pudo obtener mapa masivo de chats: {e}", file=sys.stderr)
    return mapping


async def resolver_telefono_waha(client: httpx.AsyncClient, waha_url: str, api_key: str, lid: str, chats_map: dict[str, str]) -> str:
    """Consulta WAHA para obtener el teléfono de un LID."""
    if lid in chats_map:
        return chats_map[lid]

    headers = {"X-Api-Key": api_key}
    try:
        resp = await client.get(f"{waha_url}/api/contacts", headers=headers, params={"contactId": f"{lid}@lid", "session": "default"}, timeout=10.0)
        if resp.status_code == 200:
            data = resp.json() or {}
            candidates = [
                data.get("phoneNumber"),
                data.get("number"),
                data.get("pnJid"),
                (data.get("_data") or {}).get("notifyName"),
            ]
            for cand in candidates:
                phone = clean_phone(cand)
                if phone and len(phone) <= 13:
                    return phone
    except Exception:
        pass
    return ""


async def main():
    parser = argparse.ArgumentParser(description="Migración y limpieza de candidatos con LID.")
    parser.add_argument("--apply", action="store_true", help="Ejecuta los cambios en la base de datos.")
    parser.add_argument("--dry-run", action="store_true", help="Simula los cambios sin modificar la BD.")
    args = parser.parse_args()

    if not args.apply and not args.dry_run:
        print("⚠️ Debes especificar --dry-run (para simular) o --apply (para ejecutar).")
        print("Ejemplo: python3 migrar_lids_duplicados.py --dry-run")
        sys.exit(1)

    is_dry_run = not args.apply

    db_url = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@localhost:5433/virgo_db")
    waha_url = os.environ.get("WAHA_BASE_URL", "http://localhost:3000")
    api_key = os.environ.get("WAHA_API_KEY", "")

    print("=" * 70)
    print("🚀 INICIANDO MIGRACIÓN Y LIMPIEZA DE LIDS")
    print(f"Modo: {'🔍 SIMULACIÓN (DRY RUN)' if is_dry_run else '⚡ APLICACIÓN REAL'}")
    print("=" * 70)

    # 1. Obtener mapa de chats de WAHA
    print("\n[1/3] Conectando a WAHA y obteniendo mapa de chats...")
    chats_map = await fetch_waha_chats_mapping(waha_url, api_key)
    print(f"      Chats vinculados encontrados en WAHA: {len(chats_map)}")

    # 2. Conectar a PostgreSQL
    conn = await asyncpg.connect(db_url)
    try:
        # Buscar todos los candidatos con LID (> 13 dígitos numéricos o con @lid)
        rows = await conn.fetch("""
            SELECT id, telefono, nombre, estado, vacante_interes, nave_interes, 
                   resumen_ia, fecha_entrevista, ultima_interaccion, empresa_id
            FROM candidatos
            WHERE length(telefono) > 13 OR telefono LIKE '%@%'
            ORDER BY created_at ASC;
        """)

        print(f"\n[2/3] Candidatos con LID encontrados en la BD: {len(rows)}")

        fusionados_eliminados = 0
        renombrados = 0
        sin_resolver = 0

        async with httpx.AsyncClient(timeout=15.0) as http_client:
            for r in rows:
                lid_raw = str(r["telefono"]).split("@")[0].strip()
                lid_id = r["id"]
                nombre_lid = r["nombre"] or "Candidato"

                # Resolver número real
                tel_real = await resolver_telefono_waha(http_client, waha_url, api_key, lid_raw, chats_map)

                if not tel_real:
                    sin_resolver += 1
                    continue

                # Verificar si el número real YA existe en la tabla candidatos
                real_cand = await conn.fetchrow("""
                    SELECT id, telefono, nombre, estado, vacante_interes, nave_interes, 
                           resumen_ia, fecha_entrevista, ultima_interaccion
                    FROM candidatos
                    WHERE telefono = $1 AND id != $2
                    LIMIT 1;
                """, tel_real, lid_id)

                if real_cand:
                    # CASO A: YA EXISTE EL NÚMERO REAL -> FUSIONAR Y ELIMINAR EL LID DUPLICADO
                    real_id = real_cand["id"]
                    print(f"  🔗 [FUSIÓN] LID {lid_raw} ({nombre_lid}) -> ya existe {tel_real} ({real_cand['nombre']}). Se fusiona y elimina duplicado.")

                    if not is_dry_run:
                        async with conn.transaction():
                            # 1. Reasignar conversation_history
                            await conn.execute("""
                                UPDATE conversation_history
                                SET candidato_id = $1, telefono = $2
                                WHERE candidato_id = $3 OR telefono = $4
                            """, real_id, tel_real, lid_id, lid_raw)

                            # 2. Reasignar o limpiar mensajes_bandeja
                            mb_real_existe = await conn.fetchval("SELECT 1 FROM mensajes_bandeja WHERE candidato_id = $1", real_id)
                            if mb_real_existe:
                                await conn.execute("DELETE FROM mensajes_bandeja WHERE candidato_id = $1 OR telefono = $2", lid_id, lid_raw)
                            else:
                                await conn.execute("""
                                    UPDATE mensajes_bandeja
                                    SET candidato_id = $1, telefono = $2
                                    WHERE candidato_id = $3 OR telefono = $4
                                """, real_id, tel_real, lid_id, lid_raw)

                            # 3. Unificar n8n_chat_histories
                            await conn.execute("""
                                UPDATE n8n_chat_histories
                                SET session_id = $1
                                WHERE session_id = $2 OR session_id = $3 OR session_id = $4
                            """, f"{tel_real}@c.us", f"{lid_raw}@c.us", f"{lid_raw}@lid", f"{tel_real}@lid")

                            # 4. Actualizar datos en el registro del candidato real si el LID tenía info útil
                            await conn.execute("""
                                UPDATE candidatos
                                SET nombre = COALESCE(NULLIF(candidatos.nombre, 'Candidato'), $1, candidatos.nombre),
                                    vacante_interes = COALESCE(NULLIF(candidatos.vacante_interes, ''), $2, candidatos.vacante_interes),
                                    nave_interes = COALESCE(NULLIF(candidatos.nave_interes, ''), $3, candidatos.nave_interes),
                                    resumen_ia = COALESCE(NULLIF(candidatos.resumen_ia, ''), $4, candidatos.resumen_ia),
                                    fecha_entrevista = COALESCE(NULLIF(candidatos.fecha_entrevista, ''), $5, candidatos.fecha_entrevista),
                                    ultima_interaccion = GREATEST(candidatos.ultima_interaccion, $6)
                                WHERE id = $7
                            """, r["nombre"], r["vacante_interes"], r["nave_interes"], r["resumen_ia"], r["fecha_entrevista"], r["ultima_interaccion"], real_id)

                            # 5. Limpiar tablas secundarias del LID
                            await conn.execute("DELETE FROM rate_limiting WHERE telefono = $1", lid_raw)
                            await conn.execute("DELETE FROM cola_mensajes WHERE telefono = $1 OR telefono = $2", lid_raw, f"{lid_raw}@c.us")

                            # 6. ELIMINAR EL REGISTRO DUPLICADO DEL CANDIDATO CON LID
                            await conn.execute("DELETE FROM candidatos WHERE id = $1", lid_id)

                    fusionados_eliminados += 1

                else:
                    # CASO B: NO EXISTE EL NÚMERO REAL -> RENOMBRAR ESTE REGISTRO AL NÚMERO REAL
                    print(f"  ✏️ [MIGRAR] LID {lid_raw} ({nombre_lid}) -> se actualiza a su número real {tel_real}.")

                    if not is_dry_run:
                        async with conn.transaction():
                            # 1. Actualizar candidatos
                            await conn.execute("""
                                UPDATE candidatos
                                SET telefono = $1
                                WHERE id = $2
                            """, tel_real, lid_id)

                            # 2. Actualizar conversation_history
                            await conn.execute("""
                                UPDATE conversation_history
                                SET telefono = $1
                                WHERE telefono = $2 OR candidato_id = $3
                            """, tel_real, lid_raw, lid_id)

                            # 3. Actualizar mensajes_bandeja
                            await conn.execute("""
                                UPDATE mensajes_bandeja
                                SET telefono = $1
                                WHERE telefono = $2 OR candidato_id = $3
                            """, tel_real, lid_raw, lid_id)

                            # 4. Actualizar n8n_chat_histories
                            await conn.execute("""
                                UPDATE n8n_chat_histories
                                SET session_id = $1
                                WHERE session_id = $2 OR session_id = $3
                            """, f"{tel_real}@c.us", f"{lid_raw}@c.us", f"{lid_raw}@lid")

                            # 5. Actualizar rate_limiting y cola
                            await conn.execute("UPDATE rate_limiting SET telefono = $1 WHERE telefono = $2", tel_real, lid_raw)
                            await conn.execute("UPDATE cola_mensajes SET telefono = $1 WHERE telefono = $2", tel_real, lid_raw)

                    renombrados += 1

        print("\n" + "=" * 70)
        print("📊 RESUMEN DE LA EJECUCIÓN:")
        print(f"  • Total registros con LID revisados:        {len(rows)}")
        print(f"  • Duplicados fusionados y ELIMINADOS:       {fusionados_eliminados}")
        print(f"  • Registros migrados a número real:         {renombrados}")
        print(f"  • LIDs aún no vinculados por WhatsApp:      {sin_resolver}")
        print("=" * 70)
        if is_dry_run:
            print("\n💡 Esto fue una SIMULACIÓN. Para aplicar los cambios reales ejecuta:")
            print("   docker compose exec backend python3 /app/scripts/migrar_lids_duplicados.py --apply\n")
        else:
            print("\n✅ CAMBIOS APLICADOS CON ÉXITO EN LA BASE DE DATOS.\n")

    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
