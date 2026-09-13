# Contexte de build = RACINE du dépôt (docker-compose : context: .), car le
# backend importe shared/prompt.mjs (source unique thèmes/catégories).
#
# Build en deux étapes : better-sqlite3 épinglé dans package-lock.json n'a pas
# de prebuild pour Node 24 → node-gyp compile. Les outils de compilation
# (python3/make/g++) restent dans l'étage "deps" et n'entrent pas dans l'image
# finale.
FROM node:24-bookworm-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY backend/package.json ./
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
