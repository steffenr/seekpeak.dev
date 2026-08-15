# ADR 003: Self-contained static deliverable

Status: accepted
Date: 2026-08-14

## Context
"No backend – just a static webpage", deployable anywhere, and the visitor
should not need to serve the file. Pure `fetch('config.json')` fails when a
page is opened via `file://` (Chrome blocks CORS for file URLs).

## Decision
Single self-contained `index.html`:
- Config is shipped as a JS export **inlined into the page**
  (`window.CONFIG = {...}`), JSON-compatible shape per ADR 002, so the site
  works from double-click `file://`, `python -m http.server`, or any static
  host — no serving requirements.
- A build step may produce the compiled Tailwind v4 CSS; the artifact stays
  one HTML file.
- Vanilla JavaScript only, no framework.

The JSON config remains the single source of truth for windows, pricing,
and site metadata; the inlined JS export mirrors it and is fed into the
build's `__SITE_URL__` / `__OG_IMAGE_URL__` head tokens.

## Consequences
- Zero runtime file loading → immune to `file://` CORS issues.
- Config edits require touching the page (or a tiny generator step), since
  there is no external config file to hot-swap. Accepted.
- The inlined `app.js` is minified with `terser` at build (`keep_fnames` +
  `mangle.reserved`) so `verify.cjs` can still re-inject `window.__t = { … }`
  by original name and test the shipped code.
- The deliverable also ships small sibling static assets alongside the single
  HTML: `dist/og-image.png` (the authored Open Graph image) and
  `dist/robots.txt`.