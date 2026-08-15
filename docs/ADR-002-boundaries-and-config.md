# ADR 002: Boundary semantics and config schema

Status: accepted
Date: 2026-08-14

## Context
Need deterministic peak/off-peak boundaries at exact instants, and a
config schema for windows + pricing.

## Decision

### Boundary semantics
Half-open intervals `[start, end)` computed on UTC:
`06:00:00.000` is peak, `10:00:00.000` is off-peak, `04:00:00.000`
off-peak. No races at boundaries.

### Config schema (as built)
```json
{
  "peakWindows": [["01:00", "04:00"], ["06:00", "10:00"]],
  "models": [
    {
      "id": "deepseek-v4-flash",
      "name": "deepseek-v4-flash",
      "cacheHit": { "offPeak": 0.007, "peak": 0.014 },
      "cacheMiss": { "offPeak": 0.22, "peak": 0.44 },
      "output": { "offPeak": 0.66, "peak": 1.32 }
    },
    {
      "id": "deepseek-v4-pro",
      "name": "deepseek-v4-pro",
      "cacheHit": { "offPeak": 0.022, "peak": 0.044 },
      "cacheMiss": { "offPeak": 0.66, "peak": 1.32 },
      "output": { "offPeak": 1.98, "peak": 3.96 }
    }
  ],
  "site": {
    "url": "https://seekpeak.dev",
    "name": "Seek Peak"
  }
}
```
The `site` block feeds the build-time head tokens (`__SITE_URL__`,
`__OG_IMAGE_URL__` — canonical, og:*, JSON-LD); the domain is never
hardcoded elsewhere. `name` mirrors `id` and is kept for parity with
pricing elsewhere; renderers currently use `id`.

### Local blocks may wrap midnight
Per-timezone projections (e.g. `23:00 -> 03:00` PDT) cross the day
boundary. The 24h timeline and next-transition logic must handle wrap.

## Consequences
- Config stores only UTC windows; local display is derived at runtime,
  DST-correct via `Intl`.
- No hardcoded per-timezone tables (would lie under DST).