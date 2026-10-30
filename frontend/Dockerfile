FROM node:22-alpine AS deps

RUN corepack enable && corepack prepare pnpm@12.11.2 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build
COPY . .
RUN pnpm run build

FROM node:22-alpine AS production

RUN corepack enable && corepack prepare pnpm@12.11.2 --activate

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/vite.config.ts ./vite.config.ts

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# CMD ["pnpm", "exec", "vite", "preview", "--host", "0.0.0.0", "--port", "3000"]
CMD ["./node_modules/.bin/vite", "preview", "--host", "0.0.0.0", "--port", "3000"]