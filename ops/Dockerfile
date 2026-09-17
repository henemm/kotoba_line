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

# #183 follow-up: encoding an uploaded recording to MP3
# (server/src/audio-encode.js) shells out to this, the same way the import
# scripts already do on the host — but this runs *in* the container, which
# needs its own copy.
RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY server/package.json ./
COPY server/src ./src
COPY server/migrations ./migrations
COPY server/bin ./bin
# Search matches romaji with the client's own converter (v69), imported as
# ../../client/src/romaji.js from src/ — so it sits at /client/src, as in the
# repository. romaji.js imports pitch.js; neither touches the DOM.
COPY client/src/romaji.js client/src/pitch.js /client/src/
# ES modules, as the repository's root package.json declares for client/.
RUN echo '{ "type": "module" }' > /client/package.json

# #183: the nightly generator for words without a recording
# (import/generate-word-sounds.js, run by ops/generate-word-sounds.sh) runs
# from this same image, so it is always the code that was deployed — laid out
# under /repo as in the repository, because it imports across server/,
# client/ and import/ by relative path.
COPY server/src /repo/server/src
COPY server/migrations /repo/server/migrations
COPY client/src/typing.js client/src/pitch.js /repo/client/src/
COPY import/generate-word-sounds.js import/word-sound-overrides.tsv /repo/import/
COPY import/lib/word-sounds.js import/lib/encode-mp3.js import/lib/mp3gain.js import/lib/wav-level.js \
     import/lib/kana-yoon-sounds.js import/lib/kana.js /repo/import/lib/
RUN echo '{ "type": "module" }' > /repo/package.json \
 && ln -s /app/node_modules /repo/server/node_modules

# The image ships no data directory; it is a mounted host volume (§9), and
# the container must be able to write the SQLite file and its WAL sidecars.
RUN mkdir -p /data && chown -R node:node /data /app /client /repo
USER node

VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
