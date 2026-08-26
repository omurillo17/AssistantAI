# Migraciones de base de datos

`virgo_data/scripts/database_setup.sql` es el esquema completo, pero Postgres
solo lo ejecuta cuando arranca con el volumen **vacío**. Sobre la base de
producción, que ya existe, no aplica nada: por eso los cambios de esquema
necesitan un sitio propio.

Cada archivo `.sql` de esta carpeta es un cambio incremental. `scripts/deploy.sh`
los aplica en orden alfabético y anota cuáles ya corrieron en la tabla
`schema_migrations`, así que una migración se aplica **una sola vez**.

## Añadir una

1. Crea `NNN_descripcion_corta.sql` con el siguiente número libre.
2. Escribe el cambio de forma **idempotente** siempre que puedas
   (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP ... IF EXISTS`). Si algún día
   hay que reaplicarla a mano, que no reviente.
3. Refleja el mismo cambio en `database_setup.sql`, para que una base creada
   desde cero nazca ya con él.
4. Pruébala antes contra producción sin dejar rastro:

   ```bash
   { echo "BEGIN;"; cat migrations/00N_lo_que_sea.sql; echo "ROLLBACK;"; } \
     | docker compose exec -T postgres psql -U <usuario> -d virgo_db -v ON_ERROR_STOP=1
   ```

   Si el `ROLLBACK` llega sin errores, la migración compila y no rompe las
   escrituras existentes.

## Lo que estas migraciones no hacen

**No se revierten solas.** El script devuelve el frontend a la imagen anterior
si el arranque falla, pero la base ya quedó migrada. Por eso conviene que los
cambios sean aditivos: añadir una columna, un índice o un trigger es seguro de
dejar puesto aunque el código vuelva atrás; renombrar o borrar una columna deja
la versión anterior sin poder arrancar.

Si necesitas un cambio destructivo, pártelo en dos despliegues: primero añade lo
nuevo y deja de usar lo viejo, y solo cuando esa versión lleve un tiempo estable
haz la migración que borra.
