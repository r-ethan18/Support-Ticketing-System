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
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist/index.js"]
