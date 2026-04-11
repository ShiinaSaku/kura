# Kura

<p align="center">
	<img src="https://res.cloudinary.com/anuraghazra/image/upload/v1594908242/logo_ccswme.svg" width="96" alt="Kura Logo" />
</p>

<p align="center">
	<strong>Self-hosted GitHub README cards with production-safe defaults.</strong>
</p>

<p align="center">
	A modern fork of <a href="https://github.com/anuraghazra/github-readme-stats">github-readme-stats</a>, built for reliability, portability, and predictable behavior across platforms.
</p>

<p align="center">
	<a href="https://vercel.com/new/clone?repository-url=https://github.com/shiinasaku/kura"><img alt="Deploy with Vercel" src="https://vercel.com/button" /></a>
	<a href="https://deploy.workers.cloudflare.com/?url=https://github.com/shiinasaku/kura"><img alt="Deploy to Cloudflare" src="https://deploy.workers.cloudflare.com/button" /></a>
	<a href="https://railway.app/new"><img alt="Deploy on Railway" src="https://img.shields.io/badge/Deploy-Railway-0B0D0E?logo=railway&logoColor=white" /></a>
	<a href="https://dashboard.render.com/select-repo?type=web"><img alt="Deploy on Render" src="https://img.shields.io/badge/Deploy-Render-46E3B7?logo=render&logoColor=111" /></a>
	<a href="https://fly.io/docs/launch/" ><img alt="Deploy on Fly.io" src="https://img.shields.io/badge/Deploy-Fly.io-7B3FE4?logo=flydotio&logoColor=white" /></a>
</p>

## Why Kura

- Drop-in compatible routes for stats, pin, top languages, wakatime, and gist cards
- Token-aware GitHub client with retry and fallback behavior
- Cache headers and health endpoints for production operations
- Built with Hono and TypeScript-first internals

## Quick Start

1. Fork this repository.
2. Add at least one GitHub token (`PAT_1` or `GITHUB_TOKEN`) in environment variables.
3. Deploy to your preferred platform.
4. Use your deployed base URL in README image links.

Example:

```md
![Stats](https://kura.kmi.moe/api?username=shiinasaku)
```

## API Endpoints

| Route                      | Description           |
| -------------------------- | --------------------- |
| `/api?username=`           | GitHub stats card     |
| `/api/pin?username=&repo=` | Repository pin card   |
| `/api/top-langs?username=` | Top languages card    |
| `/api/wakatime?username=`  | WakaTime card         |
| `/api/gist?id=`            | Gist card             |
| `/api/status/up`           | Service/token health  |
| `/api/status/pat-info`     | Token diagnostic info |

## Platform-Agnostic Deployment Guide

This project is runtime-portable. If your platform supports running a Node.js command with env vars, it can host Kura.

Checked-in platform configs in this repo:

- `vercel.json` (Vercel routing/runtime)
- `wrangler.toml` + `worker.ts` (Cloudflare Workers)
- `railway.json` (Railway start command)
- `render.yaml` (Render blueprint)
- `fly.toml` (Fly.io baseline)

### Build

No bundler is required.

- `pnpm run build` is a no-op because this project deploys directly without a bundle step.
- Optional strict check: `pnpm run typecheck`.

### Vercel

- Use the deploy button above.
- Set environment variables:
  - `PAT_1` (required)
  - Optional: `PAT_2`, `PAT_3`, ...
  - Optional: `FETCH_MULTI_PAGE_STARS=true`
  - Optional: `CACHE_SECONDS=86400`
- Build command: none
- Start command: `node --env-file=.env --import tsx dev.js`

This repo includes a ready-to-use `vercel.json` wired for Hono on Vercel.

### Cloudflare Workers (Hono-first)

- This repo includes `wrangler.toml` and `worker.ts`.
- Set secrets:
  - `wrangler secret put PAT_1`
  - Optional: `wrangler secret put PAT_2`
- Local dev:
  - `pnpm run dev:cf`
- Deploy:
  - `pnpm run deploy:cf`

The worker runs in module mode (`export default app`) with `nodejs_compat` enabled in `wrangler.toml`.

### Deploy to Cloudflare Button

Use this in any README/docs page:

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/shiinasaku/kura)
```

Direct URL:

```text
https://deploy.workers.cloudflare.com/?url=https://github.com/shiinasaku/kura
```

This repository includes:

- `wrangler.toml` for Worker config and bindings
- `.dev.vars.example` for local Worker secret examples
- `build` and `deploy` scripts in `package.json` so Workers Builds can auto-detect commands

### Railway / Render / Fly.io / Other PaaS

- Create a web service from this repository.
- Runtime: Node.js 24+ (recommended).
- Start command: `node --env-file=.env --import tsx dev.js`
- Expose port from `PORT` env var.
- Configure the same environment variables listed above.

This repo includes baseline config files for these platforms (`railway.json`, `render.yaml`, `fly.toml`).

Optional Bun command:

- `bun --env-file=.env dev.js`

## GitHub Actions Deploy Pipelines

This repo includes ready workflows:

- `.github/workflows/deploy-cloudflare-workers.yml`
- `.github/workflows/deploy-vercel.yml`

### Required repository secrets

Cloudflare:

- `CLOUDFLARE_API_TOKEN`

Vercel:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

After adding secrets, pushing to `main` (or manual `workflow_dispatch`) deploys automatically.

### Docker (works nearly everywhere)

If your platform prefers containers, use this minimal Node.js setup:

```dockerfile
FROM node:24-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
ENV NODE_ENV=production
EXPOSE 9000
CMD ["node", "--import", "tsx", "dev.js"]
```

## Production Hardening Checklist

Use this checklist to avoid common production errors:

1. Add multiple PATs (`PAT_1`, `PAT_2`, `PAT_3`) to reduce rate-limit failures.
2. Keep token scopes minimal but sufficient (`repo` + `read:user` for classic token when needed).
3. Confirm health endpoint after deploy: `/api/status/up?type=json`.
4. Confirm token diagnostics: `/api/status/pat-info`.
5. Use `FETCH_MULTI_PAGE_STARS=true` only if you need full star accuracy for >100 repos.
6. Set `CACHE_SECONDS` to reduce GitHub API pressure.
7. Keep at least one fallback token valid at all times.
8. Use a custom domain + CDN caching at edge when supported.

## Environment Variables

| Variable                 | Required                | Purpose                                   |
| ------------------------ | ----------------------- | ----------------------------------------- |
| `PAT_1`                  | Yes (or `GITHUB_TOKEN`) | Primary GitHub token                      |
| `PAT_2`, `PAT_3`, ...    | No                      | Retry/failover tokens                     |
| `GITHUB_TOKEN`           | Optional                | Alternative primary token                 |
| `CACHE_SECONDS`          | Optional                | Global cache override                     |
| `FETCH_MULTI_PAGE_STARS` | Optional                | Fetch stars across pages (`true`/`false`) |
| `WHITELIST`              | Optional                | Restrict usernames                        |
| `GIST_WHITELIST`         | Optional                | Restrict gist IDs                         |
| `EXCLUDE_REPO`           | Optional                | Global repo exclusions                    |

Example `.env`:

```bash
PAT_1=ghp_xxxxx
PAT_2=ghp_yyyyy
CACHE_SECONDS=86400
FETCH_MULTI_PAGE_STARS=true
```

Example `.dev.vars` for Wrangler local development:

```bash
PAT_1=ghp_xxxxx
PAT_2=ghp_yyyyy
```

## Local Development

```bash
pnpm install
cp .env.example .env
# add PAT_1 in .env
pnpm dev
```

Server runs at `http://localhost:9000`.

## Card Usage Examples

```md
![Stats](https://api.kmi.moe/api?username=shiinasaku&show_icons=true)
![Top Langs](https://api.kmi.moe/api/top-langs?username=shiinasaku&layout=compact)
![Repo](https://api.kmi.moe/api/pin?username=shiinasaku&repo=github-readme-stats)
![Gist](https://api.kmi.moe/api/gist?id=bbfce31e0217a3689c8d961a356cb10d)
```

All major query parameters from upstream are supported. For complete option reference, see:

- https://github.com/anuraghazra/github-readme-stats#readme

## Reliability Notes

- No hosted app can guarantee zero runtime errors under all external API/network conditions.
- Kura reduces operational risk via token rotation, health endpoints, and cache controls.
- For best uptime, self-host with multiple tokens and reasonable cache settings.

## Credits

- Original project: https://github.com/anuraghazra/github-readme-stats

## License

MIT
