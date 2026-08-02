# CareerForge demo container (M10-02). Multi-stage, pnpm-workspace-aware, non-root.
#
# Execution model: this repo runs its TypeScript sources directly on Node 24
# (type-stripping) with NO build step -- apps/api's dev script is literally
# `node src/main.ts`. Node refuses to strip types for files under node_modules
# (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), so the runtime image keeps the
# physical workspace layout (apps/*, packages/*) and runs sources from there,
# exactly as dev does -- NOT a flattened `pnpm deploy` tree.
#
# The no-nuxt / no-Nitro invariant is met by a FILTERED production install:
# `--filter @careerforge-app/api...` installs only the API's dependency graph
# (core/db/llm/scoring/resume-render + third-party prod deps). apps/web is not a
# dependency of apps/api, so nuxt/vite/vue never enter the runtime image. The
# generated SPA is served as pure static bytes from WEB_DIST_DIR; the Nitro
# server output (.output/server) is never produced or copied.
#
# glibc base (bookworm-slim, not alpine) so @node-rs/argon2 uses its prebuilt.

# ---- Stage 1: build the SPA payload (needs the full dev dependency tree) ----
FROM node:24-bookworm-slim AS web-build
WORKDIR /app
ENV CI=1
RUN corepack enable

# Manifests first so the install layer caches on lockfile changes only.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/portfolio/package.json apps/portfolio/
COPY packages/config/package.json packages/config/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/llm/package.json packages/llm/
COPY packages/resume-render/package.json packages/resume-render/
COPY packages/scoring/package.json packages/scoring/
RUN pnpm install --frozen-lockfile

# Sources (.dockerignore keeps docs/, .env*, .git, .output, .claude out).
COPY . .

# Same-origin SPA payload: NUXT_PUBLIC_API_BASE='' bakes apiBase:"" at generate
# time (Leg G), so the shipped bytes carry no absolute API origin.
RUN NUXT_PUBLIC_API_BASE='' pnpm --filter @careerforge-app/web generate

# ---- Stage 2: runtime (API graph only; no nuxt/vite/devDeps) ----
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    WEB_DIST_DIR=/app/web-dist
RUN corepack enable

# Manifests first, then a filtered production install: only apps/api and its
# workspace + third-party dependency graph. apps/web is excluded, so nuxt/vue
# are never installed. Workspace deps resolve to the physical packages/* dirs
# (outside node_modules), so Node can type-strip their sources at runtime.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/portfolio/package.json apps/portfolio/
COPY packages/config/package.json packages/config/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/llm/package.json packages/llm/
COPY packages/resume-render/package.json packages/resume-render/
COPY packages/scoring/package.json packages/scoring/
RUN pnpm install --prod --frozen-lockfile --filter "@careerforge-app/api..."

# Real source trees, run in place. Only the API's own workspace graph -- NOT
# apps/web or apps/portfolio sources. @careerforge/config is a dev-tooling
# package (eslint/tsconfig/vitest bases, no runtime import), so only its
# manifest is present. Includes packages/db/migrations (+ meta/).
COPY apps/api/src ./apps/api/src
COPY packages/core/src ./packages/core/src
COPY packages/db/src ./packages/db/src
COPY packages/db/migrations ./packages/db/migrations
COPY packages/llm/src ./packages/llm/src
COPY packages/resume-render/src ./packages/resume-render/src
COPY packages/scoring/src ./packages/scoring/src

# Generated SPA payload -- pure static bytes; the Nitro server output is never
# built or copied (the no-Nitro wall, image-asserted by the smoke).
COPY --from=web-build /app/apps/web/.output/public ./web-dist
COPY docker-entrypoint.sh ./docker-entrypoint.sh

EXPOSE 4301
USER node
ENTRYPOINT ["./docker-entrypoint.sh"]
