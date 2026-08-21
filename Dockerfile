FROM node:22.19.0-alpine3.22 AS build
ENV CI=true
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/config/package.json packages/config/package.json
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY apps/api apps/api
COPY packages packages
RUN pnpm --filter @trail/api... build && \
    pnpm --filter @trail/api deploy --prod /prod/api

FROM node:22.19.0-alpine3.22 AS migration
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S trail && adduser -S trail -G trail
COPY --from=build --chown=trail:trail /prod/api ./
COPY --from=build --chown=trail:trail /workspace/apps/api/src/db/migrations ./dist/db/migrations
USER trail
CMD ["node", "dist/db/migrate.js"]

FROM node:22.19.0-alpine3.22 AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S trail && adduser -S trail -G trail
COPY --from=build --chown=trail:trail /prod/api ./
USER trail
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/server.js"]
