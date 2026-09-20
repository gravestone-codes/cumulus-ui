# API + UI image. The API serves the UI bundle same-origin (decision 11).
# pnpm deploy materializes a self-contained prod node_modules (workspace
# symlinks would break if copied piecemeal into distroless).
FROM node:24-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/ui/package.json ./apps/ui/
COPY packages/spec/package.json ./packages/spec/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @cumulus/api build && pnpm --filter @cumulus/ui build
RUN pnpm --filter @cumulus/api deploy --prod /app/deploy

FROM gcr.io/distroless/nodejs24-debian12 AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV STATIC_DIR=/app/public
COPY --from=build /app/deploy/dist ./dist
COPY --from=build /app/deploy/node_modules ./node_modules
COPY --from=build /app/deploy/package.json ./
COPY --from=build /app/deploy/migrations ./migrations
COPY --from=build /app/deploy/fixtures ./fixtures
COPY --from=build /app/apps/ui/dist ./public
EXPOSE 3000
CMD ["dist/index.js"]
