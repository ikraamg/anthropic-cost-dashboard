# Anthropic Cost Dashboard

A single-page dashboard for exploring your Anthropic API usage and costs. Enter your admin API key, pick a date range, and see exactly where your tokens are going.

**Live:** [anthropic-cost-dashboard.ikraamghoor.com](https://anthropic-cost-dashboard.ikraamghoor.com)

## Features

- **Cost breakdown** by model, API key, workspace, service tier, context window, geo, or speed
- **Stacked bar chart** showing cost over time grouped by any dimension
- **Sortable tables** — grouped breakdown + per-entry cost log
- **Row selection** — click, shift+click, or cmd+click rows to sum costs in a sticky bar
- **CSV export** for further analysis
- **Flexible date range** with 1-minute, 1-hour, or 1-day bucket widths
- **Pagination** — auto-fetches all pages for large date ranges

## Security

- API key is kept in memory only (never persisted to disk or localStorage)
- Cloudflare Worker proxies API calls server-side (no CORS, no key exposure to third parties)
- Subresource Integrity (SRI) on CDN scripts
- Content Security Policy headers
- XSS-escaped API response data

## Local Development

```
node serve.js
```

Opens at [localhost:3010](http://localhost:3010). The local proxy forwards `/v1/*` requests to `api.anthropic.com`.

## Deployment

Deployed on Cloudflare Workers + Static Assets. Push to `main` triggers auto-deploy.

- `worker.js` — proxies `/v1/*` to Anthropic API
- `public/` — static assets (HTML, JS, headers)
- `wrangler.jsonc` — Cloudflare config

## Pricing

Cost estimates use published Anthropic rates (configurable in `public/app.js`). Cache read tokens priced at 10% of base input, cache write at 125%, batch at 50% discount.

## License

MIT
