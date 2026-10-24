# Meridian

**Meridian: the AI week, wherever it lands.**

A weekly briefing of the week's biggest AI stories, explained plainly, with a local read for the place each story lands. Ten minutes, once a week, published on Tuesday morning Hong Kong time.

This repo is a rebuild of the old Edge Daily site. Milestone 1 is a working end-to-end weekly edition: a Next.js site, Postgres, a Node pipeline you run as a CLI, blocking checks before approval, and an admin API to approve, reject, or request changes.

## What you need to set up by hand

1. Create a Railway project and add a Postgres plugin, **or** create a Neon database. Copy the `DATABASE_URL`.
2. Create an Anthropic API key.
3. Set the env vars below on the Railway web service and on the Railway cron service.
4. Run migrate and seed sources once.
5. If you still have the old Vercel project, switch it only after Railway is live. Vercel is optional.

## Deploy on Railway (primary)

The site is a normal Node Next.js app. The weekly pipeline is the same repo, started as a cron service that runs a CLI script. There is no cron inside the web process.

### 1. Web service

1. New Railway project from this GitHub repo.
2. Add a Postgres plugin, or paste a Neon `DATABASE_URL`.
3. Use the Dockerfile in the repo (`railway.json` already points at it).
4. Set these variables on the **web** service:

```
DATABASE_URL=
SITE_URL=https://YOUR-APP.up.railway.app
ADMIN_API_KEY=
CRON_SECRET=
ANTHROPIC_API_KEY=
PUBLISH_MODE=manual
PROCESS_ROLE=web
```

5. Generate a public URL. That URL is `SITE_URL`.
6. After the first deploy, run these from a one-off Railway shell or your laptop with the same `DATABASE_URL`:

```bash
npm run db:migrate
npm run db:seed-sources
```

### 2. Pipeline cron service

Add a second Railway service from the same repo. Use the same Dockerfile. Override the start command so this service is the CLI, not the website.

**Daily ingest** (05:30 Hong Kong time = 21:30 UTC):

- Start command: `PROCESS_ROLE=pipeline PIPELINE_JOB=ingest node scripts/start.mjs`
- Cron schedule: `30 21 * * *`

**Monday compile** (18:00 Hong Kong time = 10:00 UTC Monday):

You can either add a third service, or change the one cron service's schedule and `PIPELINE_JOB`. A simple setup is two cron services:

- Ingest: `PIPELINE_JOB=ingest`, `30 21 * * *`
- Compile: `PIPELINE_JOB=compile`, `0 10 * * 1`

Give the cron service the same env vars as the web service, plus:

```
PROCESS_ROLE=pipeline
PIPELINE_JOB=compile
```

The compile job writes a draft edition, runs blocking checks, and leaves it in review. Approve it with the admin API to publish the edition page. Compile does not send messages.

### 3. Approve or reject an edition

`PUBLISH_MODE=manual` is the default. A passing compile stays in review until you approve it. Do not turn on auto-publish unless you mean to.

Use `ADMIN_API_KEY` (Bearer token). Cron can start ingest or compile with `CRON_SECRET`, but only `ADMIN_API_KEY` can approve or reject.

List editions waiting for a decision, with private preview links:

```bash
curl -H "Authorization: Bearer $ADMIN_API_KEY" \
  https://YOUR-APP.up.railway.app/api/admin/editions
```

Approve, reject, or send it back to draft:

```bash
curl -X POST https://YOUR-APP.up.railway.app/api/admin/editions \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"editionWeek":"2026-W43","action":"approve"}'
```

`action` can be `approve`, `reject`, or `changes`. Approve publishes the edition page. The preview URL is a private look at the draft only. It does not have approve buttons.

If `ADMIN_API_KEY` is missing, these routes refuse every request.

## Local setup

```bash
npm install
cp .env.example .env
```

Without `DATABASE_URL`, local commands use a file database in `.data/`. That is for demo and tests only.

```bash
npm run demo
npm run dev
```

`npm run demo` migrates, seeds the hand-picked sources, and publishes a mock Week 1 edition so you can click through the site without API keys.

### Pipeline CLI

```bash
npx tsx scripts/pipeline.ts ingest --dry-run
npx tsx scripts/pipeline.ts compile --mock
npx tsx scripts/pipeline.ts remind
```

`--mock` / `--dry-run` writes an edition without calling Anthropic. Use this in CI or when keys are not set.

`remind` only prints editions still waiting for approval. It does not send messages.

## Env vars

| Name | Required | What it does |
| --- | --- | --- |
| `DATABASE_URL` | Yes in production | Railway Postgres or Neon |
| `SITE_URL` | Yes in production | Canonical URL for RSS, sitemap, and private preview links |
| `ADMIN_API_KEY` | Yes to approve or trigger by HTTP | Admin routes fail closed if unset |
| `CRON_SECRET` | No | Extra secret for ingest / compile callers |
| `ANTHROPIC_API_KEY` | Yes for live writing | Not needed for `--mock` |
| `PUBLISH_MODE` | No | `manual` (default) or `auto` |
| `PUBLISH_KILL_SWITCH` | No | When auto is on, this forces human review |
| `FEATURE_X_SOURCES` | No | Off by default. X costs per read |
| `MODEL_WRITING` | No | Default `claude-sonnet-5-5` |
| `MODEL_CHECKS` | No | Default `claude-haiku-4-5` |

## Sources

The hand-picked list lives in `data/sources.csv`. Seed it with `npm run db:seed-sources`. That list is the default: a short set of labs and newsrooms, plus Hacker News as a signal. Adding a source is a curation choice. The product does not ingest a giant scrape.

Supported source types for that list:

- RSS / Atom
- Hugging Face models API, filtered by author org
- Hacker News via Algolia (signal only: never cited; missing HN attention does not lower a story)
- X stays off unless `FEATURE_X_SOURCES` is on

## Historical posts

Meridian starts at Week 1. The earlier Edge Daily posts were deliberately not carried over. Old `/post/:slug` and `/archive/v1/:slug` links now go to the weekly archive.

## Checks and approval

Before an edition can be approved, these blocking checks must pass:

- Freshness (7-day window in code)
- Source floor (two sources, or one primary)
- Style (no em dashes, no hype words, required sections)
- Links resolve (skipped only in mock mode)
- Edition shape (5 to 7 stories; each story is tagged by place, with no Asia quota)

Approve, reject, or request changes with `POST /api/admin/editions` and `ADMIN_API_KEY`. Approve publishes the edition page. `PUBLISH_MODE=manual` is the default. `PUBLISH_MODE=auto` publishes only when the configured eval thresholds are met. Otherwise it stays in review for the same admin API.

## Tests

```bash
npm test
```

CI runs tests and a production build on every push.

## Optional: Vercel

Railway is the host. If you still want a Vercel frontend later:

1. Import the repo into Vercel.
2. Set the same env vars, including `DATABASE_URL`.
3. Do **not** put a cron in the Next.js server. Keep the Railway cron service (or the GitHub Actions example below).

There is no Vercel-only cache or image API in this app. Pages render from Postgres on each request so they work the same on Railway.

## Optional: GitHub Actions cron

`docs/examples/pipeline.github-actions.yml` is a manual alternative you can copy into `.github/workflows/` if you want. It has no schedule. Railway cron is the one that should run every week.

## Project layout

```
config/                 models, publish mode, source lists
data/                   vetted sources
drizzle/migrations/     Postgres + pgvector schema
scripts/pipeline.ts     CLI used by Railway cron
src/app/                Next.js pages, RSS, sitemap, admin API
src/lib/pipeline/       ingest, filters, rank, write, checks
src/lib/pipeline/sources/   rss, huggingface, hackernews, x, scrape stub
```

## Design credits

The public pages follow patterns from these MIT-licensed projects. Their code was adapted, not copied as a theme. Colours and fonts stay the original Edge Daily look (Geist, Notion-style tokens).

- [shadcn/ui](https://ui.shadcn.com) (MIT) for Card, Badge, Button, Separator, Breadcrumb, Pagination, ToggleGroup, Sheet, Alert, Input, Label, and Skeleton
- [timlrx/tailwind-nextjs-starter-blog](https://github.com/timlrx/tailwind-nextjs-starter-blog) (MIT) for the wide list layout, search, previous/next story nav, and article masthead
- [taxonomy](https://github.com/shadcn-ui/taxonomy) by shadcn (MIT) for the reading column and Tailwind `prose`
- [Magic UI blog template](https://github.com/magicuidesign/blog-template) (MIT) for the featured lead, tag chips, and image-card grid
- [Magic UI](https://github.com/magicuidesign/magicui) (MIT) for the newsletter signup band
- Vercel’s Next.js blog starter (MIT) for a sticky blurred header and a footer with about / nav / follow columns

Look-and-feel notes also came from publications such as Rest of World, The Verge, TLDR and Morning Brew. No code was copied from those sites.

No non-permissive templates were used.
