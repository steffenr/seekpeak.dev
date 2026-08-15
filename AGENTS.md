# AGENTS.md

## Project

**Seek Peak** — a zero-dependency static page that tells a visitor whether the DeepSeek API is currently in peak (2× price) or off-peak time, in their own timezone. Neo-brutalist design: black borders + hard shadows (`#000000`), monospace font, 8 user-selectable color themes (5 dark + 3 light).

**Domain model (see `docs/ADR-001`/`ADR-002`/`GLOSSARY.md`):**
- The **verdict is computed on UTC now** — identical for every visitor at any instant.
- Peak windows are half-open `[start, end)` UTC intervals: `01:00–04:00` and `06:00–10:00`. `06:00:00.000` is peak; `10:00:00.000` is off-peak. No races at boundaries.
- The visitor timezone is **display-only**: it changes which clock you read, never the price. Per-timezone blocks are derived at runtime via `Intl` (DST-correct) — never hardcoded.
- Output is a **single self-contained `index.html`** (works from `file://`). No backend, no framework, vanilla JS only (see `docs/ADR-003`).

## Commands

```bash
npm run build                      # REQUIRED before verify — builds dist/index.html
npm run watch                      # rebuild on change
node scripts/verify.cjs            # the test suite (reads built dist/index.html)
npm run build && node scripts/verify.cjs   # standard check — MUST be green before finishing any task
```

- Build (`scripts/build.mjs`): runs Tailwind v4 CLI to compile `src/style.css` → minified CSS, then inlines that CSS + `config.json` (as `window.CONFIG`) + `src/app.js` into `index.template.html` → `dist/index.html`. A leftover placeholder (`/*__CSS__*/` etc.) throws.
- There is **no separate lint/typecheck** target — `verify.cjs` + the build are the only gates.

## Architecture & key files

| File | Role |
|---|---|
| `index.template.html` | Source of the single-page layout: hero badge card (`#badgeCard`, `#badgeText`, `#badgeMsg`, `#countdown`), pricing table, timeline (`#timeline`), timezone picker, footer. Contains the FOUC theme script in `<head>` and the `/*__CSS__|__CONFIG__|__APP__*/` placeholders. |
| `src/app.js` | Single IIFE. All logic: verdict (`isPeak`, `nextTransition`), timezone math (`localMidnight`, `localHour`, `tzOffsetMin`, `offsetLabel`), minute-precision engine (`minuteMask`, `hourFraction`, `peakRuns`, `fmtBoundary`), pure UI helpers (`countdownText`, `priceModeText`, `taglineText`, `timelineHourLabel`, `isNowHour`), and thin DOM renderers (`renderBadge`, `renderTagline`, `renderCountdown`, `renderPriceMode`, `renderTimeline`, `renderPriceTable`, `renderTzLabel`, `renderTzList`, theme renderers). |
| `src/style.css` | Tailwind v4 source: `@theme` tokens (`mk-bg`, `mk-fg`, `mk-card`, `mk-input`, `mk-ink`, `mk-cyan`, `mk-pink`, `mk-yellow`, `mk-green`, `mk-purple`, `mk-orange`, `mk-muted`, `mk-badge-peak`, `mk-badge-off`) + 8 `[data-theme=…]` override blocks. |
| `config.json` | Single source of truth: `peakWindows` + `models` (deepseek-v4-flash, deepseek-v4-pro) with `cacheHit`/`cacheMiss`/`output` offPeak/peak prices. |
| `scripts/verify.cjs` | Test harness (node `vm`). Reads the BUILT `dist/index.html`, parses config + inlined app, mocks DOM/localStorage/setInterval, re-injects `window.__t = { …exports… }`, then runs assertions. |
| `scripts/build.mjs` | Build pipeline described above. |
| `docs/` | `ADR-001/002/003`, `GLOSSARY.md`, and `superpowers/specs|plans/` (feature design docs + implementation plans). |

## Verify.cjs conventions (test suite)

- It tests the **built artifact** (`dist/index.html`), so always `npm run build` first.
- Pure logic functions are exported from `src/app.js` by injecting `window.__t = { name, … };` — to test a new pure helper, add its name to that injected object AND write assertions in the corresponding block.
- DOM-bound renderers are NOT unit-tested (the `elem()` mock is a no-op); test their pure logic instead (e.g. `taglineText`, `priceModeText`, `timelineHourLabel`).
- Static template expectations are asserted via string/regex checks on `html` (e.g. `data-col="model"`, `<details`, absence of `clockLocal`). Remember `dist` inlines `src/app.js`, so identifier-presence checks scan the JS too.
- Existing assertion style: `if (!cond) { console.log("FAIL …"); process.exit(1); }` + `console.log("… ✓")`.
- Reference-based cross-checks exist for `isPeak` (all 86400 seconds) and a Colombo (UTC+5:30) minute-mask case.

## Code conventions

- **Pure logic separated from DOM:** pure helpers (testable, exported) feed thin renderers. Follow this split for any new logic — never compute inside a renderer without a pure counterpart.
- Verdict helpers: `isPeak(now)` (UTC), `nextTransition(now)` returns the next flip instant (never null for valid config). `minuteMask(now, tz)` → boolean[1440]; `hourFraction(mask, h)`; `peakRuns(mask)` → half-open `[startMin, endMin]`; `fmtBoundary(mid, tz, min)` → `"HH:MM"` (clamps min ≥ 1440 to `"24:00"`).
- **Countdown gotcha:** format the transition `Date` directly via `part(d, tz, "hour"/"minute")` — do NOT reuse `fmtBoundary` (it clamps to `24:00`). ICU zero-pads minute only when `hour` is also requested (`{hour:"2-digit", minute:"2-digit"}`) — there is a comment in `countdownText` about this; do not "simplify" it.
- Renderers read fresh `isPeak(now)` locally (not `state.peak`) to avoid ordering coupling (`renderCountdown`, `renderTagline`, `renderPriceMode`).
- `setInterval` (1s) drives `renderCountdown` every tick; on a verdict flip it re-renders badge, tagline, priceMode, priceTable, timeline.
- Tailwind JIT: any class used in JS must appear as a **complete literal string** in `src/app.js`/`index.template.html` (no dynamic class-name interpolation) or it will be purged.
- No comments unless they explain a non-obvious invariant (e.g. the ICU padding note).
- Don't touch `src/app.js`'s IIFE structure or the export-injection line in verify.cjs carelessly — they must stay in sync.

## Themes

- Theme key: `deepseek-peak-theme` (localStorage), default `monokai-pro`, invalid → default, wrapped in try/catch. `[data-theme]` is set on `documentElement` by both the inline `<head>` FOUC script and `src/app.js`.
- 8 themes (favorites first): monokai-pro, solarized-dark, tokyo-night, dracula, one-dark, one-light, solarized-light, github-light.
- `mk-ink` stays `#19181a` in every theme; solarized-dark uses `#073642` for card/input. Light themes declare `color-scheme: light`; chip ink is always `text-mk-ink`, never `text-mk-bg`.
- Badge text color tokens (`--color-mk-badge-peak` / `--color-mk-badge-off`) are defined per theme; the Tailwind minifier may rewrite `#800000` to `maroon` (same value) — theme-block regexes in verify.cjs tolerate this.
- Adding a theme requires: a `[data-theme=…]` block in `src/style.css`, a `THEMES` entry in `src/app.js`, and (optionally) updating the theme list in verify.cjs.

## Git / workflow

- Repo is git on branch **`develop`**. **User preference: the working tree is intentionally left uncommitted** — do not run `git commit` unless explicitly asked.
- Feature work follows the superpowers flow: brainstorm → spec in `docs/superpowers/specs/` → plan in `docs/superpowers/plans/` → execute (often subagent-driven) → verify. Design/architecture decisions go in `docs/ADR-*.md` + `docs/GLOSSARY.md`.
- Shell is restrictive: `node -e`/`-p` and `nohup`/`pgrep`/`lsof` are blocked — use script files under `scripts/` for one-off node eval, and plain tools otherwise. On macOS, `grep` needs `--` before patterns starting with `-`.
- Verify every task with `npm run build && node scripts/verify.cjs`. Visual/browser smoke tests require a human or Browser MCP (not connected by default) — open `dist/index.html`.
