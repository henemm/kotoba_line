# Build context is the repository root, so that server/ is copyable.
#   docker build -f ops/Dockerfile -t kotoba-line-server .

# ── build ────────────────────────────────────────────────────────────
# better-sqlite3 is a native addon and alpine is musl, which the published
# prebuilds usually miss — so it compiles here, in a stage that is thrown away.
FROM node:22-alpine AS build

RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# ── runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/data

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY server/package.json ./
COPY server/src ./src
COPY server/migrations ./migrations
COPY server/bin ./bin

# The image ships no data directory; it is a mounted host volume (§9), and
# the container must be able to write the SQLite file and its WAL sidecars.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
