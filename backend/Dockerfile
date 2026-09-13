# Contexte de build = RACINE du dépôt (docker-compose : context: .), car le
# backend importe shared/prompt.mjs (source unique thèmes/catégories).
# bookworm-slim (glibc) → prebuilds better-sqlite3 dispo, pas de compilation.
FROM node:24-bookworm-slim

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY backend/src ./src
COPY backend/tools ./tools
# Résolu depuis src/routes/../../../shared → /shared
COPY shared /shared

# Jamais root dans le conteneur. Le volume ./backend/data doit appartenir à
# l'uid 1000 sur l'hôte :  sudo chown -R 1000:1000 backend/data
RUN mkdir -p /app/data && chown -R node:node /app
USER node

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
