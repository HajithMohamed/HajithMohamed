# Deployment

Two services: the **frontend** (Next.js) on **Vercel** and the **backend**
(NestJS API) on **Render**. PostgreSQL is hosted on **Supabase** (external to
both). Backend deploy configuration is in `render.yaml` at the repository root.

## Vercel — Frontend

Import the repository into Vercel and set **Root Directory** to
`my_portfolio_website/frontend`. This is the directory containing the Next.js
`package.json`; do not use the repository root.

- Framework Preset: Next.js (automatically detected)
- Build Command: `npm run build` (the default)
- Install Command: `npm install` (the default)
- Output Directory: leave unset; Next.js manages `.next` automatically.

Required environment variables (Project Settings → Environment Variables):

- `NEXT_PUBLIC_API_URL` — the Render backend URL, e.g. `https://hz-labs-api.onrender.com`
- `NEXT_PUBLIC_SITE_URL` — the Vercel production URL, e.g. `https://your-project.vercel.app`

Do not deploy the NestJS backend to Vercel.

## Render — Backend

Config: `render.yaml` (repo root). Create a **Blueprint** from the repo; Render
reads `render.yaml`, which sets `rootDir: my_portfolio_website` and runs:

- Build: `npm ci && npm run prisma:generate --workspace backend && npm run build --workspace backend`
- Start: `npm run prisma:deploy --workspace backend && npm run start:prod --workspace backend`
- Health check: `/health`

Set these secrets in the Render dashboard (they are `sync: false` in the blueprint):

- `DATABASE_URL` — Supabase IPv4 **Session pooler** connection string
- `FRONTEND_URL` — the Vercel production URL (used for CORS)
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`
- `GITHUB_TOKEN`
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`

`JWT_ACCESS_SECRET` is generated automatically by Render. `ADMIN_NAME`,
`ADMIN_SESSION_TTL_MINUTES`, `NODE_ENV`, and `NODE_VERSION` are set in the blueprint.
Render provides `PORT` automatically.

Prisma migrations run on every deploy via the start command (`prisma migrate
deploy`). To seed the first admin/content once, run locally against the
production database:

```powershell
npm.cmd run prisma:seed --workspace backend
```

Swagger is available at `/docs`; health is available at `/health`.

> **Free plan note:** Render's free web service sleeps after ~15 minutes of
> inactivity (cold start on the next request) and will not stay awake for the
> in-process 6-hour GitHub sync. For an always-on API and reliable scheduled
> sync, use a paid instance type (or ping `/health` on a schedule).
