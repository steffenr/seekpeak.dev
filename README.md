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
`docs/ADR-004`). Per-timezone blocks are derived at runtime via `Intl`
(DST-correct) — never hardcoded. Configuration (windows + prices +
weekend rule) lives in `config.json`, the single source of truth.

See `DESIGN.md` for the full design, and `docs/ADR-*.md` + `docs/GLOSSARY.md`
for the committed domain-model decisions.

## Referral sub-pages

Alongside the verdict page, the build emits three static sub-pages to
`dist/<slug>/index.html`:

| Slug | Page |
|------|------|
| `agentrouter` | AgentRouter.org referral + setup write-up |
| `omp` | Why the oh-my-pi (omp) coding agent |
| `free-credits` | Hand-checked list of provider sign-up credits |

Each is `<slug>.template.html` with `/*__CSS__*/` and `/*__SUB_APP__*/`
placeholders, a `@source` line in `src/style.css`, a watch target in
`scripts/build.mjs`, and an assertion block in `scripts/verify.cjs`. They share
one small bundle (`src/subpage.js`, theme picker only) and the theme list from
`src/themes.js`. The homepage and the `omp` "credit" CTA link to
`/free-credits/`.

The `free-credits` offers are **not** hand-written in the template. `credits.json`
at the repo root is the single source of truth — one object per offer (`provider`,
`credits`, `creditsShort`, `url`, `featured`, `stars` 1–5, `models`, optional
`blurb`/`note`). `scripts/build.mjs` (via `scripts/credits.mjs`) renders the offer
cards, the page's FAQ JSON-LD, the homepage/omp CTA copy, and regenerates
`free-credits.gist.md` — a standalone Markdown copy for posting as a GitHub Gist
(not part of `dist/`). Edit `credits.json` and run `npm run build`.

`featured: true` gives a card the pink/yellow treatment (currently B.Ai); `stars`
renders as ★/☆ behind the provider name on the CTA button.

`verify.cjs` checks the offers loosely on purpose: every `provider` in
`credits.json`, and each of its `models`, must appear on the built page **and** in
the gist. Copy, styling and star counts are left to the renderer — adding or
editing an offer is just a `credits.json` change plus `npm run build`.

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
Intl-weekday reference), half-open boundaries, countdown text, DST-transition
midnights, cross-midnight timelines, and static template / SEO / dist-file
expectations.

The site URL lives in the `site` block of `config.json` and flows through the
build into the head (canonical, og:*, JSON-LD) — never hardcode the domain in
`index.template.html`.

## Configuration

`config.json` is the single source of truth:

```jsonc
{
  "peakWindows": [["01:00", "04:00"], ["06:00", "10:00"]],  // half-open UTC, weekdays only
  "weekendOffPeak": { "timezone": "Asia/Shanghai", "days": [0, 6] },  // Sat+Sun, Beijing-anchored
  "models": [
    { "id": "deepseek-v4.1-flash", "cacheHit": { "offPeak": 0.003, "peak": 0.006 }, /* … */ },
    { "id": "deepseek-v4-pro", "note": "routes to V4.1 Flash on Sep 14, 2026", /* … */ }  // optional note renders under the model id
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
| `<slug>.template.html` | Referral sub-pages (`agentrouter`, `omp`, `free-credits`) — CSS + sub-app placeholders |
| `credits.json` | Single source of truth for the `free-credits` offers (provider, credits, url, featured, stars, models) |
| `scripts/credits.mjs` | Renders `credits.json` into the offer cards, FAQ JSON-LD, CTA copy, and the gist |
| `free-credits.gist.md` | Standalone Markdown copy of the free-credits page for a GitHub Gist — generated by the build, not built into `dist/` |
| `src/app.js` | All logic (pure, testable helpers + thin DOM renderers) |
| `src/subpage.js` | Shared sub-page bundle (theme picker only) |
| `src/themes.js` | Theme list — single source of truth, prepended to every page bundle |
| `src/style.css` | Tailwind v4 source: theme tokens + `[data-theme=…]` blocks + `@source` lines |
| `config.json` | Peak windows, weekend off-peak rule, model prices, + `site` block |
| `scripts/build.mjs` | Build pipeline (Tailwind v4 → minified CSS, then inline + dist assets) |
| `assets/og-image.png` | Your Open Graph image (1200×630 recommended), copied to `dist/og-image.png` |
| `scripts/verify.cjs` | Test suite against the built `dist/index.html` |
| `DESIGN.md` | Domain model, architecture, build pipeline, theme system, verification strategy |
| `docs/` | ADRs, glossary, and superpowers spec/plan notes |

## Not affiliated

This page is not related to deepseek.com.
