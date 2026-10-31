# WA Turbo

A desktop app that links several WhatsApp numbers on one computer and uses Claude to summarize chats, write reports and track who is still waiting for a reply (SUM UP!, beta). Everything runs locally: chats are stored in a PostgreSQL database built into the app, and nothing goes to a WA Turbo server, because there isn't one.

Current release: see [CHANGELOG.md](CHANGELOG.md). Runs on macOS (Apple Silicon); a Windows build is in development.

## What it does

- **Several numbers, one window.** Each number links as a WhatsApp linked device (Baileys, one connection per number) with its own session keys.
- **Summaries and reports.** Claude reads the messages you pick and returns a summary, actions, decisions and open questions, citing the messages it used.
- **SUM UP! (beta).** Local rules and Claude find questions and promises still waiting for an answer, on your side or theirs, with response-time clocks.
- **Pinned chats** are summarized automatically; other chats are checked for open loops.
- **Notifications**, a menu bar count of pinned chats waiting on you, per-chat mute in WA Turbo.
- **My team**: people on your side in group chats.
- **Claude usage** per number, by day and week.

### Ground rules

- **Only your own hand sends.** Messages, photos, edits and delete-for-everyone go out only when you press Send/Save or confirm. No automatic, scheduled, rule-driven or AI-written sends, no read receipts, no presence. `scripts/check-send.mjs` enforces this and runs before every build.
- **Local by default.** Claude only sees what a summary or report includes, phone numbers in the text are swapped for aliases first, and photos go only if "Let Claude see photos" is on.
- **No sample content** in the app: no demo names in copy, prompts, placeholders or seed data.

## Requirements

| | |
|---|---|
| Machine | macOS 13+ on Apple Silicon |
| Node | 22.12 or newer (`.nvmrc`). With Homebrew: `PATH=/opt/homebrew/opt/node@22/bin:$PATH` |
| Claude | Claude Code installed and signed in with a Claude plan (default), or an Anthropic API key in Settings |
| Database | None to install: PostgreSQL 18 ships inside the app |

## Getting started

```sh
npm ci
npm run postgres        # copies the bundled Postgres into vendor/postgres (trimmed, signed, smoke-tested)
npm run dev
```

If WA Turbo is installed and running on the same Mac, give the dev copy its own data folder so the two never share a lock, a database or WhatsApp credentials:

```sh
WA_TURBO_USER_DATA=/tmp/wat-dev npm run dev
```

Never link the same WhatsApp number in two copies at once; the two connections knock each other off.

### Environment variables

| Variable | Effect |
|---|---|
| `WA_TURBO_USER_DATA` | Use this folder instead of `~/Library/Application Support/WA Turbo` (config, media, built-in database) |
| `WA_TURBO_DATABASE_URL` | Use this Postgres instead of the built-in one (development and tests only) |
| `WA_TURBO_OFFLINE=1` | Open stored data without connecting to WhatsApp (screenshots, demos) |
| `WA_TURBO_NO_AUTO=1` | Turn off automatic summaries |
| `WA_TURBO_DEBUG=1` | Verbose WhatsApp (Baileys) logging |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run the app with hot reload |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | Unit tests (Vitest) |
| `npm run lint:send` | The send guard: fails if anything but your own Send/Edit/Delete can reach WhatsApp |
| `npm run postgres` | Prepare the bundled Postgres in `vendor/postgres` |
| `npm run build` | Build main, preload and renderer into `out/` |
| `npm run dist` | Send guard + Postgres + build + `.dmg` in `dist/` |
| `npm run release:patch` / `release:minor` / `release:major` | Bump the version, commit and tag (see [Releasing](#releasing)) |

## Project layout

```
src/main/          Electron main process
  db/              Postgres pool, queries, built-in server (server.ts)
  wa/              One Baileys session per number, mappers, auth state in Postgres
  ingest/          Writing WhatsApp events to the database
  loops/           SUM UP! local rules and loop service
  ai/              Claude: context, redaction, prompts, schemas, summarize, report, auto summary
  notify/          Notifications, badge, menu bar icon (never on the send path)
  ipc/router.ts    Every call the window can make
src/preload/       window.api bridge (context isolation on, sandboxed)
src/renderer/      The window: index.html, app.ts, styles/
src/shared/        Types and helpers used by both sides
migrations/        NNN_name.sql, applied in order on start, each once
scripts/           Send guard, Postgres preparation
tests/unit/        Vitest
tests/e2e/         Playwright screenshots of the running or packaged app
build/             App icon
```

## Database

- Built-in PostgreSQL 18, started and stopped by the app. Data lives in `<userData>/postgres/data`. The app connects over a private Unix socket; nothing listens on the network unless "Let database tools connect" is switched on in Settings → Database (then 127.0.0.1 only, with a password).
- Schema changes go in a new `migrations/NNN_name.sql`; never edit one that has shipped. Keep SQL compatible with PostgreSQL 12 (no `gen_random_uuid()`, no extensions) so a development database on an older server still works.

## Branches

| Branch | Purpose |
|---|---|
| `main` | **Production.** Only released code. Every commit on main is a tagged version. |
| `development` | **Integration.** Finished features land here and are tested together before a release. |
| `feature/*`, `fix/*` | One change each, branched from `development` and merged back into it. |

Never commit directly to `main`; it only receives merges from `development` (or a `hotfix/*` branch for an urgent production fix, which is then merged back into `development` too).

## Versioning

[Semantic versioning](https://semver.org): `MAJOR.MINOR.PATCH`, tags `vX.Y.Z`.

- **PATCH**: bug fixes, wording, no new behaviour.
- **MINOR**: new features, new migrations that apply automatically, anything a user notices but needs no action for.
- **MAJOR**: changes that need action from the person installing it, or that drop data or a platform. (While the version is `0.x`, these bump MINOR instead.)

The version in `package.json` names the installers (`WA Turbo-<version>-arm64.dmg`) and is what macOS shows in About. Record every user-visible change under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) as you merge it into `development`.

## Releasing

```sh
git checkout development && git pull
npm ci && npm run typecheck && npm test && npm run lint:send

git checkout main && git pull
git merge --no-ff development
# CHANGELOG.md: rename "Unreleased" to the new version with today's date, commit
npm run release:minor          # or release:patch / release:major: bumps, commits "Release vX.Y.Z", tags vX.Y.Z
git push origin main --follow-tags

git checkout development && git merge main && git push origin development
npm run dist                   # installer in dist/
```

`npm version` refuses to run with uncommitted changes, so a release always matches a clean commit.
