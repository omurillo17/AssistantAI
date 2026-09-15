#!/usr/bin/env python3
"""
Script: recuperar_pendientes_migracion.py
Descripción:
  Recupera y envía mensaje de reactivación/disculpa a los candidatos que
  escribieron durante el periodo de migración a Meta (sep 4 - sep 9) y que
  nunca recibieron respuesta del bot ni de reclutadores.

  Aplica pausas aleatorias configurables (por defecto 1 a 4 minutos) entre cada
  envío para evitar bloqueos por parte del filtro antispam de WhatsApp.

Uso:
  # 1. Simulación / ver lista de afectados (no envía nada):
  docker compose exec backend python scripts/recuperar_pendientes_migracion.py --dry-run

  # 2. Prueba con los primeros 3 candidatos:
  docker compose exec backend python scripts/recuperar_pendientes_migracion.py --apply --limit 3

  # 3. Envío real a todos con pausas de 1 a 4 min:
  docker compose exec backend python scripts/recuperar_pendientes_migracion.py --apply

  # 4. Probar con un teléfono específico:
  docker compose exec backend python scripts/recuperar_pendientes_migracion.py --apply --phone 5213323379399
"""

import argparse
import asyncio
import os
import random
import sys
import time
import httpx
import asyncpg

MENSAJE_DEFAULT = (
    "¡Hola! Disculpa la demora, tuvimos una actualización en nuestro sistema de WhatsApp. "
    "😊 Soy Sofía, reclutadora de TCi. ¿Sigues interesado en conocer nuestras vacantes disponibles? "
    "¿En qué ciudad o municipio te encuentras actualmente?"
)


def normalizar_chat_id(telefono: str) -> str:
    """Limpia el teléfono y genera el chatId estándar para WAHA."""
    if "@" in telefono:
        return telefono
    digitos = "".join(filter(str.isdigit, telefono))
    return f"{digitos}@lid" if len(digitos) > 13 else f"{digitos}@c.us"


async def enviar_waha(
    client: httpx.AsyncClient,
    waha_url: str,
    api_key: str,
    session: str,
    chat_id: str,
    texto: str,
) -> bool:
    """Envía mensaje por WAHA simulando presencia humana (typing) para seguridad."""
    headers = {"X-Api-Key": api_key, "Content-Type": "application/json"}

    # 1. Indicar que está escribiendo (typing)
    try:
        await client.post(
            f"{waha_url}/api/startTyping",
            headers=headers,
            json={"session": session, "chatId": chat_id},
            timeout=10.0,
        )
        await asyncio.sleep(random.uniform(2.5, 5.0))
        await client.post(
            f"{waha_url}/api/stopTyping",
            headers=headers,
            json={"session": session, "chatId": chat_id},
            timeout=10.0,
        )
    except Exception:
        pass  # No abortar si el typing falla

    # 2. Enviar el texto real
    try:
        resp = await client.post(
            f"{waha_url}/api/sendText",
            headers=headers,
            json={"session": session, "chatId": chat_id, "text": texto},
            timeout=25.0,
        )
        if resp.status_code in (200, 201):
            return True
        print(f"❌ Error HTTP {resp.status_code} desde WAHA: {resp.text}", file=sys.stderr)
        return False
    except Exception as exc:
        print(f"❌ Excepción enviando a WAHA: {exc}", file=sys.stderr)
        return False


async def obtener_empresa_id(conn: asyncpg.Connection) -> str:
    row = await conn.fetchval("SELECT id FROM empresas ORDER BY created_at ASC LIMIT 1;")
    if not row:
        raise RuntimeError("No se encontró ninguna empresa configurada en la BD.")
    return str(row)


async def main():
    parser = argparse.ArgumentParser(
        description="Envío espaciado a candidatos pendientes de la migración a Meta."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Ejecuta el envío real y registra en la base de datos.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Muestra los candidatos y simula sin enviar nada.",
    )
    parser.add_argument(
        "--mensaje",
        type=str,
        default=MENSAJE_DEFAULT,
        help="Texto personalizado a enviar (por defecto mensaje de disculpa y reactivación de Sofía).",
    )
    parser.add_argument(
        "--min-delay",
        type=int,
        default=60,
        help="Tiempo mínimo en segundos de espera entre mensajes (default: 60 = 1 min).",
    )
    parser.add_argument(
        "--max-delay",
        type=int,
        default=240,
        help="Tiempo máximo en segundos de espera entre mensajes (default: 240 = 4 min).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Límite máximo de candidatos a procesar en esta ejecución.",
    )
    parser.add_argument(
        "--phone",
        type=str,
        default=None,
        help="Enviar únicamente a este teléfono para pruebas.",
    )

    args = parser.parse_args()

    if not args.apply and not args.dry_run:
        print("⚠️ Debes indicar --dry-run (para simular) o --apply (para ejecutar).")
        print("Ejemplo: python scripts/recuperar_pendientes_migracion.py --dry-run")
        sys.exit(1)

    is_dry_run = not args.apply

    db_url = os.environ.get(
        "DATABASE_URL",
        "postgresql://omurillo17:IEr97CrDQ1D4tiNv2laZb84zZepxI0zJ@localhost:5433/virgo_db",
    )
    waha_url = os.environ.get("WAHA_BASE_URL", "http://localhost:3000")
    api_key = os.environ.get("WAHA_API_KEY", "")
    session = os.environ.get("WAHA_SESSION", "default")

    # Obtener número actual configurado en WAHA
    emisor_info = "Desconocido"
    try:
        async with httpx.AsyncClient(timeout=10.0) as check_client:
            res = await check_client.get(
                f"{waha_url}/api/sessions/{session}",
                headers={"X-Api-Key": api_key},
            )
            if res.status_code == 200:
                sdata = res.json()
                me = sdata.get("me", {})
                emisor_info = f"{me.get('id', 'N/A')} ({me.get('pushName', 'Sin nombre')})"
    except Exception as err:
        emisor_info = f"Error consultando WAHA: {err}"

    print("=" * 75, flush=True)
    print("🚀 RECUPERACIÓN DE CANDIDATOS SIN RESPUESTA - MIGRACIÓN A META", flush=True)
    print(f"Modo:             {'🔍 SIMULACIÓN (DRY RUN)' if is_dry_run else '⚡ ENVÍO REAL'}", flush=True)
    print(f"Número emisor:    {emisor_info} [WAHA session='{session}']", flush=True)
    print(f"Rango de retraso: {args.min_delay}s a {args.max_delay}s ({args.min_delay/60:.1f} a {args.max_delay/60:.1f} min)", flush=True)
    if args.limit:
        print(f"Límite:           {args.limit} candidatos", flush=True)
    if args.phone:
        print(f"Filtro teléfono:  {args.phone}", flush=True)
    print("=" * 75, flush=True)

    # Conectar a PostgreSQL
    conn = await asyncpg.connect(db_url)
    try:
        empresa_id = await obtener_empresa_id(conn)

        # Buscar candidatos que entraron durante el corte (id >= 20074 y sin respuesta assistant)
        query = """
            WITH afectados AS (
                SELECT 
                    ch.telefono,
                    min(ch.timestamp) AS primer_mensaje,
                    max(ch.timestamp) AS ultimo_mensaje,
                    string_agg(ch.content, ' || ' ORDER BY ch.id ASC) AS mensajes_recibidos,
                    count(*) AS total_mensajes_user
                FROM conversation_history ch
                WHERE ch.id >= 20074 
                  AND ch.role = 'user'
                  AND ch.timestamp <= '2026-09-09 16:39:11'
                GROUP BY ch.telefono
            )
            SELECT 
                a.telefono,
                a.primer_mensaje,
                a.ultimo_mensaje,
                a.mensajes_recibidos,
                a.total_mensajes_user,
                c.id AS candidato_id,
                c.nombre AS candidato_nombre,
                c.vacante_interes
            FROM afectados a
            LEFT JOIN candidatos c ON a.telefono = c.telefono
            WHERE NOT EXISTS (
                SELECT 1 FROM conversation_history resp
                WHERE resp.telefono = a.telefono 
                  AND resp.role = 'assistant' 
                  AND resp.id >= 20074
            )
            ORDER BY a.primer_mensaje ASC;
        """
        filas = await conn.fetch(query)

        if args.phone:
            filas = [f for f in filas if args.phone in str(f["telefono"])]

        if args.limit:
            filas = filas[:args.limit]

        total = len(filas)
        print(f"\n📋 Candidatos a procesar: {total}\n")

        if total == 0:
            print("✨ No hay candidatos pendientes con los filtros especificados.")
            return

        print("Mensaje a enviar:")
        print(f'"{args.mensaje}"\n')
        print("-" * 75)

        enviados_ok = 0
        fallidos = 0

        async with httpx.AsyncClient(timeout=30.0) as http_client:
            for idx, r in enumerate(filas, start=1):
                tel = str(r["telefono"]).strip()
                chat_id = normalizar_chat_id(tel)
                cand_id = r["candidato_id"]
                nombre = r["candidato_nombre"] or "Candidato"
                primer_msg = r["primer_mensaje"].strftime("%Y-%m-%d %H:%M") if r["primer_mensaje"] else "N/A"
                preview_recibido = (r["mensajes_recibidos"] or "")[:50].replace("\n", " ")

                print(f"[{idx}/{total}] Candidato: {tel} ({nombre})")
                print(f"        Primer mensaje: {primer_msg} | Recibido: \"{preview_recibido}...\"")

                if is_dry_run:
                    print(f"        -> [DRY RUN] Se enviaría a {chat_id}")
                    enviados_ok += 1
                else:
                    # 1. Asegurar registro en tabla candidatos
                    if not cand_id:
                        cand_id = await conn.fetchval(
                            """
                            INSERT INTO candidatos (telefono, nombre, estado, ultima_interaccion, empresa_id)
                            VALUES ($1, 'Candidato', 'NUEVO', NOW(), $2::uuid)
                            ON CONFLICT (telefono, empresa_id) DO UPDATE SET ultima_interaccion = NOW()
                            RETURNING id;
                            """,
                            tel,
                            empresa_id,
                        )

                    # 2. Enlazar mensajes previos huerfanos en conversation_history
                    await conn.execute(
                        "UPDATE conversation_history SET candidato_id = $1 WHERE telefono = $2 AND candidato_id IS NULL;",
                        cand_id,
                        tel,
                    )

                    # 3. Enviar por WAHA
                    ok = await enviar_waha(
                        http_client,
                        waha_url,
                        api_key,
                        session,
                        chat_id,
                        args.mensaje,
                    )

                    if ok:
                        # 4. Registrar respuesta en conversation_history
                        await conn.execute(
                            """
                            INSERT INTO conversation_history (telefono, candidato_id, role, content, message_type, timestamp)
                            VALUES ($1, $2, 'assistant', $3, 'text', NOW());
                            """,
                            tel,
                            cand_id,
                            args.mensaje,
                        )

                        # 5. Actualizar bandeja de mensajes
                        await conn.execute(
                            """
                            INSERT INTO mensajes_bandeja (candidato_id, telefono, ultimo_mensaje, ultimo_mensaje_rol, ultimo_mensaje_at, mensajes_no_leidos, activo)
                            VALUES ($1, $2, $3, 'assistant', NOW(), 0, TRUE)
                            ON CONFLICT (candidato_id) DO UPDATE SET
                                ultimo_mensaje = EXCLUDED.ultimo_mensaje,
                                ultimo_mensaje_rol = 'assistant',
                                ultimo_mensaje_at = NOW(),
                                updated_at = NOW();
                            """,
                            cand_id,
                            tel,
                            args.mensaje,
                        )

                        # 6. Registrar en cola_mensajes
                        await conn.execute(
                            """
                            INSERT INTO cola_mensajes (telefono, texto, estado, created_at, updated_at)
                            VALUES ($1, $2, 'ENVIADO', NOW(), NOW());
                            """,
                            chat_id,
                            args.mensaje,
                        )

                        print(f"        ✅ Enviado exitosamente a {chat_id}")
                        enviados_ok += 1
                    else:
                        print(f"        ❌ Falló el envío a {chat_id}")
                        fallidos += 1

                # Si no es el último, aplicar la pausa aleatoria entre 1 y 4 min
                if idx < total:
                    delay = random.uniform(args.min_delay, args.max_delay)
                    minutos = delay / 60.0
                    print(f"        ⏳ Esperando {delay:.1f}s ({minutos:.2f} min) antes del siguiente mensaje para evitar bloqueo...")
                    if not is_dry_run:
                        restante = int(delay)
                        while restante > 0:
                            bloque = min(10, restante)
                            await asyncio.sleep(bloque)
                            restante -= bloque
                            if restante > 0 and restante % 30 == 0:
                                print(f"           Faltan {restante}s...")
                print("-" * 75)

        print("\n" + "=" * 75)
        print("📊 RESUMEN FINAL:")
        print(f"  • Total seleccionados:  {total}")
        print(f"  • Enviados con éxito:  {enviados_ok}")
        print(f"  • Fallidos:            {fallidos}")
        print("=" * 75)
        if is_dry_run:
            print("\n💡 Esto fue una SIMULACIÓN. Para enviar realmente ejecuta:")
            print("   docker compose exec backend python scripts/recuperar_pendientes_migracion.py --apply\n")
        else:
            print("\n✅ Proceso completado correctamente.\n")

    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
