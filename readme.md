# kura

Dynamically generate GitHub stats cards for your README. A self-hostable fork of [github-readme-stats](https://github.com/anuraghazra/github-readme-stats), modernised with [Hono](https://hono.dev) and [ofetch](https://github.com/unjs/ofetch).

## Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/shiinasaku/kura)

1. Fork or clone this repo
2. Add your GitHub PATs as environment variables: `PAT_1`, `PAT_2`, …
3. Deploy to Vercel — zero extra config needed

## Endpoints

| Route | Description |
|---|---|
| `/api?username=` | GitHub stats card |
| `/api/pin?username=&repo=` | Repo pin card |
| `/api/top-langs?username=` | Top languages card |
| `/api/wakatime?username=` | WakaTime stats card |
| `/api/gist?id=` | Gist pin card |
| `/api/status/up` | PAT health check |
| `/api/status/pat-info` | PAT detail info |

## Local dev

```bash
npm install
cp .env.example .env  # add your PAT_1=...
npm run dev           # http://localhost:9000
```

## Themes & customization

All theming and query params from the original project are supported. See the [upstream docs](https://github.com/anuraghazra/github-readme-stats#readme) for the full option reference.

## License

MIT — original work by [Anurag Hazra](https://github.com/anuraghazra)
