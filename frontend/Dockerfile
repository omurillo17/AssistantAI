FROM node:24-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# El .env.local NO se copia: las variables vienen del entorno (docker-compose).
# Variables dummy requeridas durante next build para validación estática de rutas
ENV DATABASE_URL="postgresql://postgres:postgres@localhost:5432/virgo_db"
ENV JWT_SECRET="dummy_build_secret"
ENV WAHA_API_KEY="dummy_key"
RUN npm run build

# --- Stage 2: imagen ligera de producción ---
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
# Next.js standalone ya incluye un mini-server; solo necesitamos copiarlo.
# Todo propiedad de `node` (UID 1000, ya viene en la imagen): el servidor corre
# sin root y aun así puede escribir su caché en .next/. public/uploads es un
# bind mount de virgo_data/uploads: en el host debe ser de UID 1000 (ver
# PRODUCCION.md), el chown de aquí no alcanza al volumen.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
# Next empaqueta bcryptjs dentro de sus chunks y no lo deja en node_modules;
# scripts/crear_root.sh lo necesita suelto para hashear con `node -e`.
COPY --from=builder /app/node_modules/bcryptjs ./node_modules/bcryptjs
USER node

EXPOSE 3001
ENV PORT=3001
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
