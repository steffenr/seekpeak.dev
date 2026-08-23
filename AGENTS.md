# AGENTS.md

## Project

**Seek Peak** — a zero-dependency static page that tells a visitor whether the DeepSeek API is currently in peak (2×) or off-peak time, in their own timezone. The domain model, architecture, build pipeline and theme system are documented in `DESIGN.md`; committed decisions live in `docs/ADR-001`/`ADR-002`/`ADR-003`/`ADR-004` + `docs/GLOSSARY.md`.

## Commands

```bash
npm run build                      # REQUIRED before verify — builds dist/index.html
npm run watch                      # rebuild on change
node scripts/verify.cjs            # the test suite (reads built dist/index.html)
npm run build && node scripts/verify.cjs   # standard check — MUST be green before finishing any task
```

- There is **no separate lint/typecheck** target — the build + `verify.cjs` are the only gates.
- If you add a build placeholder token to `index.template.html`, wire it end-to-end or the build throws. Site URL/brand must keep flowing `config.json` → `build.mjs` → head tokens (`__SITE_URL__`, `__OG_IMAGE_URL__`) — never hardcode the domain.

## Verify.cjs conventions (test suite)

- It tests the **built artifact** (`dist/index.html`), so always `npm run build` first.
- Pure logic functions are exported from `src/app.js` by injecting `window.__t = { name, … };` — to test a new pure helper, add its name to that injected object AND write assertions in the corresponding block.
- DOM-bound renderers are NOT unit-tested (the `elem()` mock is a no-op); test their pure logic instead (e.g. `taglineText`, `priceModeText`, `timelineHourLabel`).
- Static template expectations are asserted via string/regex checks on `html` (e.g. `data-col="model"`, `<details`, absence of `clockLocal`). Remember `dist` inlines `src/app.js`, so identifier-presence checks scan the JS too.
- SEO/GEO static checks cover the head (canonical, og:url/og:image, twitter:card, JSON-LD `WebSite`/`FAQPage`/`speakable`, `<noscript>`, `theme-color`) and the extra dist files (`og-image.png` PNG signature, `robots.txt`; no `sitemap.xml` — single-page site). The minify check asserts the inlined `app.js` is smaller than `src/app.js`.
- Existing assertion style: `if (!cond) { console.log("FAIL …"); process.exit(1); }` + `console.log("… ✓")`.
- Reference-based cross-checks exist for `isPeak` (9 UTC days spanning two Beijing weekends, checked against an independent Intl-weekday reference) and a Colombo (UTC+5:30) minute-mask case.

## Code conventions

- **Pure logic separated from DOM:** pure helpers (testable, exported) feed thin renderers. Follow this split for any new logic — never compute inside a renderer without a pure counterpart (see `DESIGN.md` for rationale).
- Verdict helpers: `isPeak(now)` (UTC + Beijing-weekend override via `isWeekend(now)`, `docs/ADR-004`), `nextTransition(now)` returns the next flip instant (never null for valid config; scans a 10-day lookahead since a Beijing weekend can suppress up to two calendar days of window boundaries). `minuteMask(now, tz)` → boolean[1440]; `hourFraction(mask, h)`; `peakRuns(mask)` → half-open `[startMin, endMin]`; `fmtBoundary(mid, tz, min)` → `"HH:MM"` (clamps min ≥ 1440 to `"24:00"`); `badgeMsgText(peak, weekend)` → badge copy for the peak/off-peak/weekend states.
- **Countdown gotcha:** format the transition `Date` directly via `part(d, tz, "hour"/"minute")` — do NOT reuse `fmtBoundary` (it clamps to `24:00`). ICU zero-pads minute only when `hour` is also requested (`{hour:"2-digit", minute:"2-digit"}`) — there is a comment in `countdownText` about this; do not "simplify" it.
- Renderers read fresh `isPeak(now)` locally (not `state.peak`) to avoid ordering coupling (`renderCountdown`, `renderTagline`, `renderPriceMode`).
- `setInterval` (1s) drives `renderCountdown` every tick; on a verdict flip it re-renders badge, tagline, priceMode, priceTable, timeline.
- Tailwind JIT: any class used in JS must appear as a **complete literal string** in `src/app.js`/`index.template.html` (no dynamic class-name interpolation) or it will be purged.
- No comments unless they explain a non-obvious invariant (e.g. the ICU padding note).
- Don't touch `src/app.js`'s IIFE structure or the export-injection line in verify.cjs carelessly — they must stay in sync.

## Editing themes

- Theme key `deepseek-peak-theme` (localStorage), default `monokai-pro`, invalid → default, wrapped in try/catch. `[data-theme]` is set on `documentElement` by both the inline `<head>` FOUC script and `src/app.js`.
- Adding a theme requires: a `[data-theme=…]` block in `src/style.css`, a `THEMES` entry in `src/app.js`, and (optionally) updating the theme list in verify.cjs.
- The palette, invariants and FOUC/persistence design live in `DESIGN.md` (§ Theme system).

## Git / workflow

- Repo is git on branch **`develop`**. **User preference: the working tree is intentionally left uncommitted** — do not run `git commit` unless explicitly asked.
- Feature work follows the superpowers flow: brainstorm → spec in `docs/superpowers/specs/` → plan in `docs/superpowers/plans/` → execute (often subagent-driven) → verify. Design/architecture decisions go in `docs/ADR-*.md` + `docs/GLOSSARY.md`.
- Shell is restrictive: `node -e`/`-p` and `nohup`/`pgrep`/`lsof` are blocked — use script files under `scripts/` for one-off node eval, and plain tools otherwise. On macOS, `grep` needs `--` before patterns starting with `-`.
- Verify every task with `npm run build && node scripts/verify.cjs`. Visual/browser smoke tests require a human or Browser MCP (not connected by default) — open `dist/index.html`.