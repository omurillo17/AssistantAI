FROM node:24-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# El .env.local NO se copia: las variables vienen del entorno (docker-compose).
RUN npm run build

# --- Stage 2: imagen ligera de producción ---
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
# Next.js standalone ya incluye un mini-server; solo necesitamos copiarlo.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3001
ENV PORT=3001
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
