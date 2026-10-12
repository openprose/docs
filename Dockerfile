# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat git
COPY package.json pnpm-lock.yaml .npmrc* ./
RUN corepack enable && corepack prepare pnpm@latest --activate
# --ignore-scripts: postinstall runs fumadocs-mdx which needs source.config.ts.
# That file is not yet copied into the deps stage. Generate .source/ explicitly
# in the build stage instead, after COPY . . brings in the source files.
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache git
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG DOCS_PREVIEW_MODE=true
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_STAGING_KEY
ARG NEXT_PUBLIC_POSTHOG_LEGACY_PROJECT_TOKEN
ARG NEXT_PUBLIC_POSTHOG_ENVIRONMENT
ARG NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
ENV DOCS_PREVIEW_MODE=$DOCS_PREVIEW_MODE
ENV NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY
ENV NEXT_PUBLIC_POSTHOG_STAGING_KEY=$NEXT_PUBLIC_POSTHOG_STAGING_KEY
ENV NEXT_PUBLIC_POSTHOG_LEGACY_PROJECT_TOKEN=$NEXT_PUBLIC_POSTHOG_LEGACY_PROJECT_TOKEN
ENV NEXT_PUBLIC_POSTHOG_ENVIRONMENT=$NEXT_PUBLIC_POSTHOG_ENVIRONMENT
ENV NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST
ENV NEXT_TELEMETRY_DISABLED=1
RUN sh scripts/check-analytics-build.sh
RUN pnpm exec fumadocs-mdx
RUN pnpm exec next build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
