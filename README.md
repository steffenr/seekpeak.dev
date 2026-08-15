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
- **11 editor-style color themes** — persisted in `localStorage`, applied
  without flash.
- **Info dialog** ("?") — a short explanation of how the page works and why
  it exists.

## How it works

The verdict is computed on **UTC now**, so it is identical for every visitor
at any instant. Peak windows are half-open UTC intervals
(`01:00–04:00` and `06:00–10:00`): `06:00:00.000` is peak, `10:00:00.000`
is off-peak. Per-timezone blocks are derived at runtime via `Intl`
(DST-correct) — never hardcoded. Configuration (windows + prices) lives in
`config.json`, the single source of truth.

See `docs/ADR-*.md` and `docs/GLOSSARY.md` for the full domain model.

## Build

```bash
npm run build                 # compile + inline Tailwind CSS, config, app.js
npm run build && node scripts/verify.cjs   # build + run the test suite
npm run watch                 # rebuild on change
```

Output: `dist/index.html`. The test harness (`scripts/verify.cjs`) parses the
built artifact and covers verdict logic (all 86400 seconds), half-open
boundaries, countdown text, DST-transition midnights, cross-midnight
timelines, and static template expectations.

## Configuration

`config.json` is the single source of truth:

```jsonc
{
  "peakWindows": [["01:00", "04:00"], ["06:00", "10:00"]],  // half-open UTC
  "models": [
    { "id": "deepseek-v4-flash", "cacheHit": { "offPeak": 0.007, "peak": 0.014 }, /* … */ }
  ]
}
```

## Project layout

| Path | Purpose |
|------|---------|
| `index.template.html` | Single-page layout + placeholders for CSS, config, app |
| `src/app.js` | All logic (pure, testable helpers + thin DOM renderers) |
| `src/style.css` | Tailwind v4 source: theme tokens + `[data-theme=…]` blocks |
| `config.json` | Peak windows + model prices |
| `scripts/build.mjs` | Build pipeline (Tailwind v4 → minified CSS, then inline) |
| `scripts/verify.cjs` | Test suite against the built `dist/index.html` |
| `docs/` | ADRs, glossary, and design/implementation notes |

## Not affiliated

This page is not related to deepseek.com.