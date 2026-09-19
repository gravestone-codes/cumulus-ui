# API-only image. The UI bundle is served by the API from Phase 4 on; until then
# the image carries the API alone (roadmap: backend first).
FROM node:24-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/ui/package.json ./apps/ui/
COPY packages/spec/package.json ./packages/spec/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @cumulus/api build

FROM gcr.io/distroless/nodejs24-debian12 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/node_modules ./api_modules
EXPOSE 3000
CMD ["dist/index.js"]
