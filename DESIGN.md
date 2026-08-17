# Seek Peak — Design

This document records how Seek Peak works and why it is built this way. It
complements the decision records (`docs/ADR-001` verdict model, `docs/ADR-002`
boundaries & config, `docs/ADR-003` deliverable) and `docs/GLOSSARY.md`.
Operating instructions for agents live in `AGENTS.md`.

## Overview

Seek Peak is a zero-dependency static page that tells a visitor whether the
DeepSeek API is currently billed at **peak** (2×) or **off-peak** rates, in
their own timezone. Neo-brutalist visual language: black borders + hard
shadows (`#000000`), monospace type, 8 user-selectable color themes (5 dark +
3 light).

The deliverable is a single self-contained `index.html` that works from a
double-click (`file://`), any static host, or `python -m http.server` — no
backend, no runtime build, no JavaScript frameworks (see `docs/ADR-003`).

## Domain model

- **The verdict is computed on UTC now** — it is identical for every visitor
  at any instant.
- Peak windows are half-open `[start, end)` UTC intervals: `01:00–04:00` and
  `06:00–10:00`. `06:00:00.000` is peak; `10:00:00.000` is off-peak. No races
  at boundaries.
- The visitor timezone is **display-only**: it changes which clock you read,
  never the price. Per-timezone blocks are derived at runtime via `Intl`
  (DST-correct) — never hardcoded.
- `config.json` is the single source of truth for `peakWindows`, model prices,
  and the `site` block (see `docs/ADR-002`).

## Architecture

The output is assembled at build time from small, independently testable
parts:

| File | Role |
|---|---|
| `index.template.html` | Source of the single-page layout: hero badge card (`#badgeCard`, `#badgeText`, `#badgeMsg`, `#countdown`), pricing table, timeline (`#timeline`), timezone picker, footer. Contains the FOUC theme script in `<head>` and the `/*__CSS__|__CONFIG__|__APP__*/` placeholders. |
| `src/app.js` | Single IIFE holding all logic (see inventory below). |
| `src/style.css` | Tailwind v4 source: `@theme` tokens + one `[data-theme=…]` override block per theme. |
| `config.json` | Single source of truth: `peakWindows` + `models` (deepseek-v4-flash, deepseek-v4-pro) with `cacheHit`/`cacheMiss`/`output` offPeak/peak prices, + `site` block (`url`, `name`) for the SEO/OG head. |
| `scripts/build.mjs` | Build pipeline (below). |
| `scripts/verify.cjs` | Test harness against the built artifact (verification strategy below). |
| `assets/og-image.png` | User-authored Open Graph image (1200×630 recommended); copied verbatim to `dist/og-image.png`. |

### Design principles

- **Pure logic separated from DOM** — every computation lives in a pure,
  exported helper; renderers are thin and read from it. This split is what
  lets `verify.cjs` execute the real logic in a node `vm` and assert on it.
- **Renderers read a fresh `isPeak(now)` locally** (not cached `state.peak`)
  to avoid ordering coupling between the badge, tagline and price-mode
  renderers.
- A **1-second `setInterval`** drives `renderCountdown`; when the clock ticks
  past a transition it re-renders every verdict-bound section (badge, tagline,
  priceMode, priceTable, timeline).
- **Countdown formatting gotcha:** the countdown formats its target `Date`
  directly via `part(d, tz, "hour"|"minute")` and must NOT reuse `fmtBoundary`,
  which clamps minutes ≥ 1440 to `"24:00"`. ICU zero-pads the minute only when
  the hour is requested at the same time (`{hour:"2-digit", minute:"2-digit"}`).
  There is a comment in `countdownText` about this; do not simplify it away.

### Pure-logic inventory

- Verdict: `isPeak(now)` (UTC), `nextTransition(now)` → next flip instant
  (never null for valid config).
- Timezone math: `localMidnight`, `localHour`, `tzOffsetMin`, `offsetLabel`.
- Minute-precision engine: `minuteMask(now, tz)` → `boolean[1440]`,
  `hourFraction(mask, h)`, `peakRuns(mask)` → half-open `[startMin, endMin]`,
  `fmtBoundary(mid, tz, min)` → `"HH:MM"` (clamps min ≥ 1440 to `"24:00"`).
- UI text helpers: `countdownText`, `priceModeText`, `taglineText`,
  `timelineHourLabel`, `isNowHour`.

## Build pipeline

`npm run build` (`scripts/build.mjs`):

1. Tailwind v4 CLI compiles `src/style.css` → minified CSS.
2. That CSS, `config.json` (as `window.CONFIG`) and `src/app.js` are inlined
   into `index.template.html` → `dist/index.html`.
3. The inlined JS is minified with `terser` using `keep_fnames` +
   `mangle.reserved` — `verify.cjs` re-injects `window.__t = { … }` by original
   name, so helper names must survive minification.
4. A leftover template placeholder (`/*__CSS__*/`, `__SITE_URL__`,
   `__OG_IMAGE_URL__`, …) is a hard error.
5. `assets/og-image.png` → `dist/og-image.png`; `dist/robots.txt` is emitted.

The site URL flows `config.json` (`site`) → `build.mjs` → head tokens
(canonical, og:*, JSON-LD). Nothing else may hardcode the domain, and
`dist/og-image.png` is always the authored image (no sitemap — single-page
site).

There is no separate lint/typecheck target — the build + `verify.cjs` are the
only quality gates.

## Verification strategy

`scripts/verify.cjs` runs against the **built artifact** (`dist/index.html`),
never the sources, so whatever actually ships is what gets tested. The harness
parses the inlined config and app, mocks DOM/localStorage/setInterval, and
re-injects `window.__t = { … }` to reach the inlined pure helpers by name.
DOM-bound renderers are intentionally not unit-tested (the `elem()` mock is a
no-op) — their pure inputs are asserted instead.

Reference-based cross-checks cover `isPeak` for all 86400 seconds of a day and
a Colombo (UTC+5:30) minute-mask case, so boundary/rounding bugs in the
hand-written assertions cannot silently pass.

## Theme system

- 8 themes (favorites first): monokai-pro, solarized-dark, tokyo-night,
  dracula, one-dark, one-light, solarized-light, github-light.
- Colors are Tailwind `@theme` tokens (`mk-bg`, `mk-fg`, `mk-card`,
  `mk-input`, `mk-ink`, `mk-cyan`, `mk-pink`, `mk-yellow`, `mk-green`,
  `mk-purple`, `mk-orange`, `mk-muted`, `mk-badge-peak`, `mk-badge-off`) plus
  one `[data-theme=…]` override block per theme.
- Invariants: `mk-ink` stays `#19181a` in every theme; solarized-dark uses
  `#073642` for card/input; light themes declare `color-scheme: light`; chip
  ink is always `text-mk-ink`, never `text-mk-bg`.
- Badge text color tokens (`--color-mk-badge-peak` / `-off`) are defined per
  theme; Tailwind's minifier may rewrite `#800000` to `maroon` (same value).
- The active theme is applied on `documentElement` (`[data-theme]`) by both
  the inline `<head>` FOUC script and `src/app.js`, persisted under
  `deepseek-peak-theme` (default `monokai-pro`, invalid → default,
  try/catch-wrapped) — no flash on load.