# Support Ticketing System (STS) - Frontend

This is the web frontend for the Support Ticketing System, initialized in Phase 1 as a modern React + TypeScript application powered by Vite.

## Tech Stack

- **Framework**: React 19 (`react`, `react-dom`)
- **Language**: TypeScript (`typescript`)
- **Build Tool / Bundler**: Vite 8 (`vite`, `@vitejs/plugin-react`)
- **Code Quality & Formatting**: Biome 2.5.15 (`@biomejs/biome`)
- **Package Manager**: pnpm (v12 compatible lockfile)
- **Git Hooks**: simple-git-hooks & lint-staged & commitlint

## Scripts

| Script | Command | Description |
|---|---|---|
| `pnpm dev` | `vite` | Starts local Vite development server on port `3000` with HMR and `/api` proxy |
| `pnpm build` | `tsc && vite build` | Type-checks and builds production bundle to `dist/` |
| `pnpm preview` | `vite preview` | Previews production build locally on port `3000` |
| `pnpm type-check` | `tsc --noEmit` | Runs TypeScript compiler checks without emitting files |
| `pnpm lint` | `biome lint .` | Runs Biome linter across the project |
| `pnpm format` | `biome format --write .` | Formats all files according to Biome configuration |
| `pnpm check` | `biome check --write .` | Runs Biome format, lint, and import sorting with auto-fixes |

## Development Server & Backend Proxy

- **Default Port**: `3000` (matches Traefik routing in `docker-compose.yml`)
- **API Proxy**: Requests prefixed with `/api` are automatically proxied to the FastAPI backend running at `http://localhost:8000`.
- **Environment Variable Configuration**: The backend target can be customized by setting `VITE_BACKEND_URL` (or `VITE_API_URL`):
  ```bash
  # Example override
  VITE_BACKEND_URL=http://localhost:8080 pnpm dev
  ```
  See `.env.example` for details.

## Path Aliases

The `@/*` path alias is configured to resolve to `./src/*` across both Vite (`vite.config.ts`) and TypeScript (`tsconfig.json`).

## Docker & Container Deployment

The multi-stage `Dockerfile` has been configured for static Single Page Application (SPA) delivery:
1. **`deps` stage**: Installs project dependencies using `corepack prepare pnpm@12.11.2`.
2. **`build` stage**: Runs `pnpm run build` (`tsc && vite build`) to generate static assets in `/app/dist`.
3. **`production` stage**: Uses `node:22-alpine` running `pnpm run preview` on port `3000`, cleanly integrating behind the Traefik reverse proxy and load balancer configured in `docker-compose.yml`.
