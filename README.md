<h1 align="center">
<img width="600" alt="sp_logo" src="https://github.com/user-attachments/assets/bf4b457f-bb4c-424f-9dd7-0424409727ce" />
</h1>

# Seek Peak

A zero-dependency static page that tells you whether the DeepSeek API is
currently billed at **peak** (2×) or **off-peak** rates — in your own
timezone.

Built as a single self-contained `index.html` that works from a double-click
(`file://`), a simple static host, or `python -m http.server` — no backend,
no build at runtime, no JavaScript frameworks.

## What it shows

- **Verdict badge** — "PEAK TIME" / "OFF-PEAK TIME" for *right now*, with a
  countdown to the next transition.
- **Pricing table** — per-model prices for input (cache hit / cache miss)
  and output tokens, with the currently-applied rate highlighted.
- **Daily timeline** — minute-precision peak blocks projected onto *your*
  local clock, DST-correct.
- **Timezone picker** — auto-detected, user-selectable. The verdict is always
  computed on UTC; your timezone only changes which clocks you read.
- **8 color themes (5 dark + 3 light)** — persisted in `localStorage`, applied
  without flash.
- **Info dialog** ("?") — a short explanation of how the page works and why
  it exists.
- **Footer** — cross-links plus an icon-only link to the source repo on
  GitHub; present on every page.
- **SEO / metadata** — canonical URL, Open Graph + Twitter cards with a
  generated OG image, JSON-LD (`WebSite` / `FAQPage` / `speakable`), and a
  minimal `robots.txt`.

## How it works

The verdict is computed on **UTC now**, so it is identical for every visitor
at any instant. Peak windows are half-open UTC intervals
(`01:00–04:00` and `06:00–10:00`): `06:00:00.000` is peak, `10:00:00.000`
is off-peak — on weekdays. **Weekends are always off-peak:** Saturday and
Sunday in Beijing time (`Asia/Shanghai`, fixed UTC+8) override the UTC
windows above, all day, regardless of the visitor's own timezone (see
`docs/ADR-004`). **Chinese public holidays are also always off-peak**,
by the same Beijing-anchored override (see `docs/ADR-005`). Per-timezone
blocks are derived at runtime via `Intl` (DST-correct) — never hardcoded.
Configuration (windows + prices + weekend rule + holiday dates) lives in
`config.json`, the single source of truth.

See `DESIGN.md` for the full design, and `docs/ADR-*.md` + `docs/GLOSSARY.md`
for the committed domain-model decisions.

## Referral sub-page

Alongside the verdict page, the build emits one static sub-page to
`dist/<slug>/index.html`:

| Slug | Page |
|------|------|
| `free-credits` | Hand-checked list of provider sign-up credits |

It's `<slug>.template.html` with `/*__CSS__*/` and `/*__SUB_APP__*/`
placeholders, a `@source` line in `src/style.css`, a watch target in
`scripts/build.mjs`, and an assertion block in `scripts/verify.cjs`. It uses
a small bundle (`src/subpage.js`, theme picker only) and the theme list from
`src/themes.js`. The homepage footer links to `/free-credits/` (no prominent CTA block — kept low-key since some providers have had issues).

The `free-credits` offers are **not** hand-written in the template. `credits.json`
at the repo root is the single source of truth — one object per offer (`provider`,
`credits`, `creditsShort`, `url`, `featured`, `stars` 0–5, `models`, optional
`blurb`/`note`). `scripts/build.mjs` (via `scripts/credits.mjs`) renders the offer
cards, the page's FAQ JSON-LD, and regenerates
`free-credits.gist.md` — a standalone Markdown copy for posting as a GitHub Gist
(not part of `dist/`). Edit `credits.json` and run `npm run build`.

`featured: true` gives a card the pink/yellow treatment (currently Vyceai.com).
`stars` is validated metadata (integer 0–5) kept in `credits.json` for future
use — the current offer cards do **not** render ratings.

`verify.cjs` checks the offers loosely on purpose: every `provider` in
`credits.json`, and each of its `models`, must appear on the built page **and** in
the gist. Copy, styling and star counts are left to the renderer — adding or
editing an offer is just a `credits.json` change plus `npm run build`. The
offer data itself is validated strictly by the provider audit (see below).

## Provider audit

`credits.json` advertises third-party sign-up offers, and models/providers come
and go. `scripts/audit-credits.mjs` (`npm run audit:credits`) is a reusable,
read-only audit: it always validates the offer data, and — only when explicitly
opted in — checks referral URLs, provider model catalogs, and live inference.
Requires Node 20+ (built-in `fetch`); no extra dependencies.

```bash
npm run audit:credits                              # offline validation of credits.json only
npm run audit:credits -- --catalogs                # + referral URLs and public model catalogs
npm run audit:credits -- --catalogs --pi           # + catalogs for locally configured Pi providers
npm run audit:credits -- --live --pi --report audit-reports/<new-name>.json
                                                   # + minimal live probes (paid API usage), sanitized report
npm run audit:credits -- --credits other.json --pi /custom/pi/dir   # alternate data / Pi directory
```

- **Default is offline:** without flags the tool only validates `credits.json`
  (field types/ranges, duplicate providers/models/generated IDs/URLs, HTTPS-only
  referral URLs without embedded credentials, nonempty model arrays, consistent
  credit labels). No credentials are read, no network is used, no file is
  modified — the tool never edits `credits.json` automatically.
- **`--pi [DIR]`** reads custom models and credentials from a local Pi
  installation (`models.json`/`auth.json`; default directory
  `$PI_CODING_AGENT_DIR` or `~/.pi/agent`). Credential values may be literal or
  `$ENV_VAR` references; `!command` values are refused, never executed. Pi
  configuration itself is never modified.
- **`--live`** (requires `--pi`) sends one minimal text probe per model —
  prompt `Reply only with OK.`, at most 64 output tokens — using your
  configured keys. This is real (cheap) paid API usage. Image/audio/video
  models are never probed; at most three providers run concurrently, models
  sequentially per provider; a provider-wide quota/auth/rate-limit block stops
  its remaining probes (recorded as skipped, never as failures).
- **`--report PATH`** writes a sanitized JSON report to a **new** file
  (mode 0600, never overwrites). Reports contain no keys, no request headers,
  and no raw authenticated response bodies — review before sharing anyway.
  `audit-reports/` is gitignored.

Exit codes: `0` audit completed (findings are data, not tool failures), `1`
invalid credit data, `2` usage or I/O error.

Model statuses: `working` (final answer received); `reasoning_only`/
`incomplete` (inconclusive — not failures); `unavailable_model`/`maintenance`/
`provider_error`/`upstream_error` (provider-side problems); `quota`/
`auth_or_permission`/`rate_limited` (blocked — says nothing about the model);
`redirected`/`timeout`/`network_error` (transport); `catalog_only` (non-text
model, or present in a catalog during a catalogs-only run); `skipped`
(provider blocked earlier in the run); `unverified` (not checked: no
credentials, unsupported protocol, or checks not requested).

Limitations: a `working` verdict proves the model answered a tiny prompt — not
that sign-up, payouts, or account creation work; absence from a catalog alone
never proves an alias is broken; credit amounts are not verified. The workflow
for stale offers: run the audit → review the report → edit `credits.json` by
hand → `npm run build` (regenerates the page and gist) → `node scripts/verify.cjs`.

## Status API

Alongside the static page, `api/` holds a small read-only JSON API (PHP,
Symfony skeleton) deployed independently to `api.seekpeak.dev`:

```
https://api.seekpeak.dev/v1/status?tz=Europe/Berlin
```

`tz` is an optional IANA timezone name, case-sensitive; backward-compatible
aliases such as `Asia/Calcutta` are accepted (defaults to `UTC`; an
unrecognized value returns `400`). Response, e.g. on Thursday
2026-01-08 at 07:00 UTC:

```json
{
  "tz": "Europe/Berlin",
  "utcTime": "2026-01-08T07:00:00.000Z",
  "localTime": "2026-01-08T08:00:00+01:00",
  "peak": true,
  "reason": "window",
  "nextTransition": { "at": "2026-01-08T10:00:00.000Z", "peak": false },
  "models": [
    {
      "id": "deepseek-flash",
      "name": "deepseek-flash",
      "cacheHit": { "offPeak": 0.003, "peak": 0.006 },
      "cacheMiss": { "offPeak": 0.15, "peak": 0.3 },
      "output": { "offPeak": 0.6, "peak": 1.2 }
    }
  ]
}
```

`models` is the same per-1M-token price table (`cacheHit`/`cacheMiss`/`output`,
each with `offPeak`/`peak` rates) the static page's pricing table renders —
included so a consumer gets the verdict and the full rate table in one call.

The API reads the same repo-root `config.json` the static site does (copied
into `api/config.json` by a composer script on install — never hand-edited)
and does **not** replace the site's client-side computation; the static
page keeps working offline exactly as before.

## Build

```bash
npm run build                 # compile + minify + inline Tailwind CSS, config, app.js
npm run build && node scripts/verify.cjs   # build + run the test suite
npm run watch                 # rebuild on change
```

Output: `dist/index.html`, one `dist/<slug>/index.html` per referral sub-page,
plus `dist/og-image.png` (copied verbatim from `assets/og-image.png` — author it
yourself, 1200×630 recommended), `dist/site.webmanifest` and `dist/robots.txt`.
The inlined JS is minified with terser. The test harness
(`scripts/verify.cjs`) parses the built artifacts and covers verdict logic
(a 9-UTC-day sweep spanning Beijing weekends, checked against an independent
Intl-weekday reference), the Chinese-holiday override, half-open boundaries,
countdown text, DST-transition midnights, cross-midnight timelines, and
static template / SEO / dist-file expectations.

The site URL lives in the `site` block of `config.json` and flows through the
build into the head (canonical, og:*, JSON-LD) — never hardcode the domain in
`index.template.html`.

## Configuration

`config.json` is the single source of truth:

```jsonc
{
  "peakWindows": [["01:00", "04:00"], ["06:00", "10:00"]],  // half-open UTC, weekdays only
  "weekendOffPeak": { "timezone": "Asia/Shanghai", "days": [0, 6] },  // Sat+Sun, Beijing-anchored
  "chinaPublicHolidays": { "timezone": "Asia/Shanghai", "dates": ["2026-01-01", /* … */] },  // Beijing-anchored, updated yearly
  "models": [
    { "id": "deepseek-flash", "cacheHit": { "offPeak": 0.003, "peak": 0.006 }, /* … */ },
    { "id": "deepseek-v4-pro", /* … */ }  // optional per-model "note" string renders under the model id, unused for Pro since DeepSeek confirmed it continues past Sep 14, 2026
  ],
  "site": {
    "url": "https://seekpeak.dev",   // feeds canonical/og:/JSON-LD at build
    "name": "Seek Peak"
  }
}
```

## Project layout

| Path | Purpose |
|------|---------|
| `index.template.html` | Single-page layout + placeholders for CSS, config, app |
| `<slug>.template.html` | Referral sub-page (`free-credits`) — CSS + sub-app placeholders |
| `credits.json` | Single source of truth for the `free-credits` offers (provider, credits, url, featured, stars, models) |
| `scripts/credits.mjs` | Renders `credits.json` into the offer cards, FAQ JSON-LD, and the gist |
| `free-credits.gist.md` | Standalone Markdown copy of the free-credits page for a GitHub Gist — generated by the build, not built into `dist/` |
| `src/app.js` | All logic (pure, testable helpers + thin DOM renderers) |
| `src/subpage.js` | Shared sub-page bundle (theme picker only) |
| `src/themes.js` | Theme list — single source of truth, prepended to every page bundle |
| `src/style.css` | Tailwind v4 source: theme tokens + `[data-theme=…]` blocks + `@source` lines |
| `config.json` | Peak windows, weekend off-peak rule, Chinese public holiday dates, model prices, + `site` block |
| `scripts/build.mjs` | Build pipeline (Tailwind v4 → minified CSS, then inline + dist assets) |
| `assets/og-image.png` | Your Open Graph image (1200×630 recommended), copied to `dist/og-image.png` |
| `scripts/verify.cjs` | Test suite against the built `dist/index.html` |
| `scripts/audit-credits.mjs` | Read-only provider/model audit CLI (offline validation; opt-in catalog/live checks, sanitized reports) |
| `tests/audit-credits.test.mjs` | Offline audit tests — validation plus fully mocked network/credential/protocol regressions, run through `verify.cjs` |
| `DESIGN.md` | Domain model, architecture, build pipeline, theme system, verification strategy |
| `docs/` | ADRs, glossary, and superpowers spec/plan notes |

## Not affiliated

This page is not related to deepseek.com.
