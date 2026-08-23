# ADR 004: Weekend off-peak override (Beijing-anchored)

Status: accepted
Date: 2026-08-22

## Context
DeepSeek changed its billing policy effective 00:00 Beijing time on Sunday,
August 23, 2026: weekday peak/off-peak tiered pricing is unchanged, but
weekends (Saturday and Sunday, Beijing time) are billed uniformly at the
off-peak rate all day — the UTC peak windows (`01:00-04:00` and
`06:00-10:00`, ADR-002) no longer apply on those two days. This extends,
rather than replaces, ADR-001: the verdict must still be identical for
every visitor at a given instant.

## Decision
`isPeak(d)` first checks whether `d` falls on a Saturday or Sunday in
Beijing time (`Asia/Shanghai`, a fixed UTC+8 offset); if so, the verdict is
off-peak regardless of the UTC window. Otherwise, the existing UTC-window
logic (ADR-002) applies unchanged. Beijing time is used only as a second,
fixed anchor for *which calendar day it is* — never as the visitor's
clock — so the core ADR-001 property (same verdict for every visitor at
the same instant) is preserved.

The weekend rule is data, not code: `config.json` gains a
`weekendOffPeak: { timezone, days }` field alongside `peakWindows`,
following the same "config is the single source of truth for vendor
billing policy" principle as ADR-002.

No historical/effective-date modeling: the site implements the new rule as
the current and only rule. It does not reconstruct what the verdict would
have been before August 23, 2026.

## Consequences
- `nextTransition` must scan further than one day ahead: a weekend can
  suppress up to two calendar days of what would otherwise be peak
  windows, so "the next flip" may be up to ~63 hours out (Friday's last
  window end to Monday's first window start).
- The verify.cjs reference cross-check for `isPeak` must sweep multiple
  UTC days (previously one) to exercise the weekend boundary, using an
  independently-implemented weekend check (Intl weekday string lookup
  rather than app.js's `Date.UTC(...).getUTCDay()` approach) so a shared
  bug in the weekday computation can't hide behind a matching reference.
- UI copy that stated peak windows as unconditional (meta description,
  noscript, FAQ, "why do prices change?", info dialog) needed a weekday
  qualifier and/or a weekend explanation to stay accurate.
- `isWeekend` relies on `Intl.DateTimeFormat` support for `Asia/Shanghai`; if
  a runtime's `Intl` implementation lacks this timezone, the underlying
  `partsInTz` helper falls back to the visitor's own local clock, which
  would violate the "verdict identical for every visitor" property this ADR
  otherwise preserves. Not hardened against, since mainstream browsers and
  Node's small-icu builds carry full tzdata.

## Verification (cross-check)
- `2026-01-02T15:59:59.999Z` (Beijing Fri 23:59:59.999) → weekday, off-peak
  override does not apply.
- `2026-01-02T16:00:00.000Z` (Beijing Sat 00:00:00.000) → weekend begins,
  off-peak override applies from this instant (half-open, matching the
  window boundary convention in ADR-002).
- `2026-01-03T07:00:00.000Z` (Saturday, would be inside the `06:00-10:00`
  UTC window) → off-peak, overridden by the weekend rule.
- `2026-01-01T07:00:00.000Z` (Thursday, same UTC clock time) → peak,
  confirming the override is weekend-specific, not a UTC-window change.
