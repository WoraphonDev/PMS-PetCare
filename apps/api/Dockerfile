# syntax=docker/dockerfile:1
# API image (T-0031). Build context = repository root:
#   docker build -f apps/api/Dockerfile --build-arg BUILD_SHA=$(git rev-parse --short HEAD) -t pms-api .

FROM node:24-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
# Bundle apps/api + @app/* workspace packages (tsdown); `pnpm deploy` copies the package "files" (dist) + prod node_modules.
RUN pnpm --filter @app/api build \
 && pnpm --filter @app/api deploy --prod --legacy /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
ARG BUILD_SHA=dev
ENV BUILD_SHA=$BUILD_SHA
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/api/v1/health" > /dev/null || exit 1
CMD ["node", "dist/main.js"]
