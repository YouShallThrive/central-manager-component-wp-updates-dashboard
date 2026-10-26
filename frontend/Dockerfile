# Central Manager frontend image — built from the repo root (build context).
# Builds the Vite app (`bun run build`) with VITE_CONVEX_URL baked in, then
# serves the static bundle + index.html SPA fallback via nginx.
#
# VITE_CONVEX_URL is passed as a per-stack build arg (Coolify
# `inject_build_args_to_dockerfile`). It is the client API origin reachable from
# the BROWSER, not the loopback port.

# ---- build stage ------------------------------------------------------------
FROM node:22-slim AS build

ARG VITE_CONVEX_URL
ENV VITE_CONVEX_URL=${VITE_CONVEX_URL}

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates unzip \
    && rm -rf /var/lib/apt/lists/*

# bun (build tool for the Vite app).
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}" \
    BUN_INSTALL="/root/.bun" \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

# Install deps first (layer cache): bun.lock is the source of truth.
COPY package.json bun.lock ./
RUN bun install

# Full source tree (convex/ + src/ needed for typecheck + bundle).
COPY . .

# Build the production bundle (tsc -b && vite build). The convex/_generated/
# bindings are committed to the repo (self-hosted codegen needs the admin key,
# which is not available at image build time), so no codegen step here.
RUN bun run build

# ---- serve stage ------------------------------------------------------------
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
