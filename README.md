# NSU Docs Editor

A web-based editor for Banner database table documentation. Users edit table/column metadata, tags, and SQL queries in the browser, then submit changes as a Pull Request against the [nsu-prod-docs](https://github.com/nsuok-programmers/nsu-prod-docs) repository — no local git or manual JSON editing required.

## How it works

```
Browser  →  Cloudflare Worker  →  GitHub API  →  PR on nsu-prod-docs
```

Two components deploy independently:

- **Frontend** ([`src/`](src)) — Vite + TypeScript app, auto-deployed to GitHub Pages on push to `main`. Uses CodeMirror for SQL editing and JSZip for local export.
- **Cloudflare Worker** ([`worker/`](worker)) — serverless middleware holding GitHub App credentials and calling the GitHub API on the editor's behalf (the private key can't live in frontend code).

## Features

- Import an existing table by browsing `nsu-prod-docs` directly, or by dropping a Banner `.info` file (parsed client-side, see [`src/parser.ts`](src/parser.ts)) and an optional `.dat` file for lookup/definition tables
- Edit table metadata, columns, tags, and queries (with SQL syntax highlighting)
- Local autosave to `localStorage` (opt-in, toggle in the UI)
- Download the current table as a JSON + SQL `.zip` package
- Submit changes as a GitHub Pull Request directly from the browser

## Submission flow

Clicking **Submit to GitHub** does not open a PR against `nsu-prod-docs` directly. It:

1. Posts to the Worker's `/submit` endpoint, which commits the table's JSON/SQL/`.dat` files to a `submissions/table-definitions/...` branch **on this repo** and opens a PR into `main`.
2. Once merged, [`forward-submission.yml`](.github/workflows/forward-submission.yml) fires, forwards those files to a new branch on `nsu-prod-docs`, opens a PR there, and clears `submissions/` from `main`.

This two-hop design keeps a review/audit trail on the editor repo before anything lands in the docs repo.

## Development

```bash
npm install
npm run dev
```

For local Worker development:
```bash
cd worker
npm install
npx wrangler dev
```
When testing locally, temporarily point `WORKER_URL` in [`src/github.ts`](src/github.ts) at `http://localhost:8787`.

## Deployment / configuration reference

This instance is already configured and deployed. If you need to redeploy or reconfigure it (new GitHub App install, rotated key, moved org, etc.), these are the pieces that must stay in sync:

| File / Location | Key | Description |
|---|---|---|
| `worker/wrangler.toml` | `GITHUB_APP_ID` | GitHub App ID |
| `worker/wrangler.toml` | `GITHUB_INSTALLATION_ID` | App installation ID on the `nsuok-programmers` org |
| `worker/wrangler.toml` | `GH_OWNER` | Org that owns the docs repo (`nsuok-programmers`) |
| `worker/wrangler.toml` | `DOCS_REPO` | Docs repo name (`nsu-prod-docs`) |
| `worker/wrangler.toml` | `ALLOWED_ORIGIN` | Frontend origin for CORS — scheme + host only, e.g. `https://nsuok-programmers.github.io` |
| Wrangler secret | `GITHUB_PRIVATE_KEY` | PKCS#8 private key for the GitHub App (`worker/convert-key.js` converts GitHub's PKCS#1 download) |
| `src/github.ts` | `WORKER_URL` | Deployed Cloudflare Worker URL |
| `vite.config.ts` | `base` | Must match the GitHub Pages repo path (`/nsu-doc-editor/`) |
| Actions secret | `APP_ID` / `APP_PRIVATE_KEY` | Same App ID / PKCS#8 key, used by `forward-submission.yml` |
| `forward-submission.yml` | `owner` / repo refs | `nsuok-programmers` / `nsu-prod-docs` (3 places in the file) |

Deploy the Worker after any `wrangler.toml` or Worker code change:
```bash
npm run deploy:worker
```

The frontend deploys automatically via [`deploy.yml`](.github/workflows/deploy.yml) on every push to `main`.

## License

MIT
