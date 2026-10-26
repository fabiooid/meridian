# Meridian

**The AI week, wherever it lands.** A weekly briefing of the week's biggest AI stories, explained plainly, with a local read for the place each story lands. Ten minutes, once a week, published on Tuesday morning Hong Kong time.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node.js >= 22](https://img.shields.io/badge/node-%3E%3D22-339933)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6)
![Status: milestone 1](https://img.shields.io/badge/status-milestone%201-orange)

> [!IMPORTANT]
> Meridian is a **rebuild** of the old Edge Daily site. Milestone 1 is a working weekly edition: a Next.js site, a local demo, and a Railway deploy path. Publish stays **manual** by default. A passing compile waits for admin approval. Read [Project status](#project-status) before you treat this as a live publication.

---

## Contents

- [What it does](#what-it-does)
- [Design principles](#design-principles)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Project status](#project-status)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)
- [Design credits](#design-credits)

## What it does

Meridian compiles a Tuesday edition of five to seven AI stories. Each story is tagged by place. There is no Asia quota.

The pipeline:

1. **Ingests** a short, hand-picked source list (labs and newsrooms, plus Hacker News as a signal).
2. **Writes** a draft edition and runs **blocking checks** (freshness, sources, style, links, edition shape).
3. **Leaves it in review.** You approve, reject, or send it back with the admin API.
4. **Publishes** the edition page only after approve. Compile does not send messages.

Sources live in `data/sources.csv` and are seeded with `npm run db:seed-sources`. Adding a source is a curation choice. The product does not ingest a giant scrape.

Supported source types:

- RSS / Atom
- Hugging Face models API, filtered by author org
- Hacker News via Algolia (signal only: never cited; missing HN attention does not lower a story)
- X stays off unless `FEATURE_X_SOURCES` is on (the live client is not wired in milestone 1)

Meridian starts at Week 1. Earlier Edge Daily posts were not carried over. Old `/post/:slug` and `/archive/v1/:slug` links go to the weekly archive.

## Design principles

- **Curated sources.** A short list you choose. Adding a source is editorial, not a scrape.
- **Checks block approve.** Freshness (7-day window), source floor (two sources, or one primary), style (no em dashes, no hype words, required sections), links resolve (skipped only in mock mode), and edition shape (5 to 7 stories) must pass first.
- **Manual publish is the default.** `PUBLISH_MODE=manual` keeps a passing compile in review until you approve it. Auto-publish is opt-in and still falls back to review when thresholds are not met.

## Quick start

**Requirements:** Node.js 22 or newer, and npm.

```bash
git clone https://github.com/fabiooid/meridian.git
cd meridian
npm install
cp .env.example .env
```

Without `DATABASE_URL`, local commands use a file database in `.data/`. That is for demo and tests only. No API keys are needed for the demo path.

```bash
npm test
npm run demo
npm run dev
```

`npm run demo` migrates, seeds the hand-picked sources, and publishes a mock Week 1 edition so you can click through the site.

Then open [http://localhost:3000](http://localhost:3000).

### Pipeline CLI

```bash
npx tsx scripts/pipeline.ts ingest --dry-run
npx tsx scripts/pipeline.ts compile --mock
npx tsx scripts/pipeline.ts remind
```

`--mock` / `--dry-run` writes an edition without calling Anthropic. Use this in CI or when keys are not set.

`remind` only prints editions still waiting for approval. It does not send messages.

### Approve an edition

`PUBLISH_MODE=manual` is the default. A passing compile stays in review until you approve it. Do not turn on auto-publish unless you mean to.

Use `ADMIN_API_KEY` (Bearer token). Cron can start ingest or compile with `CRON_SECRET`, but only `ADMIN_API_KEY` can approve or reject. If `ADMIN_API_KEY` is missing, these routes refuse every request.

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

### Deploy on Railway

The site is a Node Next.js app. The weekly pipeline is the same repo, started as a cron service that runs a CLI script. There is no cron inside the web process.

**Web service**

1. New Railway project from this GitHub repo. Add a Postgres plugin, or paste a Neon `DATABASE_URL`.
2. Use the Dockerfile in the repo (`railway.json` already points at it).
3. Set the web env vars in [Configuration](#configuration), including `PROCESS_ROLE=web` and `PUBLISH_MODE=manual`.
4. Generate a public URL. That URL is `SITE_URL`.
5. After the first deploy, run migrate and seed once from a one-off Railway shell, or from your laptop with the same `DATABASE_URL`:

```bash
npm run db:migrate
npm run db:seed-sources
```

**Pipeline cron**

Add a second Railway service from the same repo and Dockerfile. Override the start command so this service is the CLI, not the website. A simple setup is two cron services:

| Job | Start command | Cron (UTC) | Hong Kong time |
| --- | --- | --- | --- |
| Daily ingest | `PROCESS_ROLE=pipeline PIPELINE_JOB=ingest node scripts/start.mjs` | `30 21 * * *` | 05:30 |
| Monday compile | `PROCESS_ROLE=pipeline PIPELINE_JOB=compile node scripts/start.mjs` | `0 10 * * 1` | Monday 18:00 |

Give the cron services the same env vars as the web service, plus `PROCESS_ROLE=pipeline` and the matching `PIPELINE_JOB`. Compile writes a draft, runs blocking checks, and leaves it in review. Approve it with the admin API. Compile does not send messages.

If you still have the old Vercel project, switch it only after Railway is live. Vercel is optional. Do not put a cron in the Next.js server. Keep the Railway cron service.

`docs/examples/pipeline.github-actions.yml` is a manual alternative you can copy into `.github/workflows/` if you want. It has no schedule. Railway cron is the one that should run every week.

CI runs `npm test` and a production build on every push.

## Configuration

Settings come from `.env` (see [`.env.example`](.env.example)):

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Railway Postgres or Neon. Required in production. Local demo uses a file database when this is unset. |
| `SITE_URL` | Canonical URL for RSS, sitemap, and private preview links |
| `ADMIN_API_KEY` | Admin routes fail closed if unset. Needed to approve or reject. |
| `CRON_SECRET` | Optional extra secret for ingest / compile callers |
| `ANTHROPIC_API_KEY` | Live writing. Not needed for `--mock` |
| `PUBLISH_MODE` | `manual` (default) or `auto` |
| `PUBLISH_KILL_SWITCH` | When auto is on, this forces human review |
| `FEATURE_X_SOURCES` | Off by default. X costs per read, and the live client is not wired in milestone 1 |
| `MODEL_WRITING` | Default `claude-sonnet-5-5` |
| `MODEL_RANKING` | Default `claude-sonnet-5-5` |
| `MODEL_CHECKS` | Default `claude-haiku-4-5` |
| `PROCESS_ROLE` | `web` (default) or `pipeline` |
| `PIPELINE_JOB` | `ingest` or `compile` when `PROCESS_ROLE=pipeline` |

`.env`, local databases and private data stay out of git. Keep them that way.

## Project status

Meridian is in **milestone 1**: a working end-to-end weekly edition, not a mature live publication.

**Working**

- [x] Next.js site for the weekly edition, archive, RSS, and sitemap
- [x] Local demo with a file database and a mock Week 1 edition (no API keys)
- [x] Pipeline CLI: ingest, compile, remind
- [x] Blocking checks before approval
- [x] Admin API to approve, reject, or request changes
- [x] Hand-picked sources (RSS, Hugging Face, Hacker News as signal)
- [x] Railway web service and cron via `PROCESS_ROLE`
- [x] Tests and CI (`npm test` and a production build)

**Not yet**

- [ ] Sending the briefing by email or chat (compile and remind never send messages)
- [ ] Live X ingest (the flag exists; the client is not wired)
- [ ] Page-scrape and email source adapters (stubs only)
- [ ] Treating auto-publish as the normal path (it exists, stays off, and still needs a human when thresholds fail)
- [ ] Carrying over old Edge Daily posts (deliberately not migrated)

## Contributing

Contributions are welcome. Please read **[CONTRIBUTING.md](CONTRIBUTING.md)** first. Use only public or fictional sample data. Never commit credentials, traces, or databases. Run `npm test` before opening a pull request.

## Security

Please **do not open public issues for security problems.** Report them privately through GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) on this repository.

Never paste tokens into issues or pull requests.

## License

[MIT](LICENSE) © 2026 Fabio Vella. Third-party dependencies keep their own licenses.

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
