# syntax=docker/dockerfile:1
FROM oven/bun:1.4.2 AS base
WORKDIR /app

FROM base AS dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN bun run build && bun run typecheck

FROM base AS production-dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM base AS runtime
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates procps util-linux iproute2 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data \
    && chown bun:bun /data
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts/start.ts ./scripts/start.ts
COPY --from=build /app/scripts/healthcheck.ts ./scripts/healthcheck.ts
COPY --from=build /app/src/server ./src/server
COPY --from=build /app/src/lib/metrics.ts ./src/lib/metrics.ts
COPY --from=build /app/package.json ./package.json
ENV NODE_ENV=production \
    PORT=3000 \
    SENTINEL_HOST=0.0.0.0 \
    SENTINEL_DB_PATH=/data/sentinel.sqlite
USER bun
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["bun", "run", "scripts/healthcheck.ts"]
CMD ["bun", "run", "scripts/start.ts"]
