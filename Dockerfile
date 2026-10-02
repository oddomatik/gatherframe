# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ARG VERSION=development
ARG REVISION=unknown
LABEL org.opencontainers.image.title="Gatherframe" \
  org.opencontainers.image.version=$VERSION \
  org.opencontainers.image.revision=$REVISION
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DATA_DIR=/data BODY_SIZE_LIMIT=Infinity
# perl is required by the vendored ExifTool (RAW previews and capture dates).
RUN apt-get update && apt-get install -y --no-install-recommends perl ca-certificates fonts-dejavu-core && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data && chown node:node /data
WORKDIR /app
COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json /app/server.js ./
COPY --from=build --chown=node:node /app/scripts/runtime-config.mjs /app/scripts/snapshot-db.mjs /app/scripts/reset-admin.cjs /app/scripts/doctor.mjs ./scripts/
COPY --from=build --chown=node:node /app/LICENSE /app/THIRD_PARTY_NOTICES.md ./
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
