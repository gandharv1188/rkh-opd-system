# syntax=docker/dockerfile:1.7
# Multi-stage Dockerfile for @rkh/dis.
#
# NOTE (DIS-001): This file is scaffolding only. It deliberately does not
# build the application — DIS-003 writes ports, DIS-004 writes the HTTP
# server at src/http/server.ts. Once those tickets land, replace the
# temporary CMD below with `CMD ["node", "dist/http/server.js"]` and add
# an explicit `RUN npm run build` step in the build stage.

# ---- Stage 1: build / deps ----
FROM node:20-alpine AS build
WORKDIR /app

# Copy manifest + lockfile first for better layer caching. The lockfile
# will exist after DIS-002 runs `npm install` at integration time.
COPY package.json package-lock.json* ./
RUN npm ci || npm install --package-lock-only

# TODO(DIS-003/DIS-004): COPY source and `RUN npm run build` once the
# server entrypoint exists.

# ---- Stage 2: runtime ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
# TODO(DIS-004): COPY --from=build /app/dist ./dist

USER node
EXPOSE 3000

# TODO(DIS-004): replace with ["node", "dist/http/server.js"]
CMD ["node", "--input-type=module", "-e", "console.log('dis stub — DIS-004 implements server')"]
