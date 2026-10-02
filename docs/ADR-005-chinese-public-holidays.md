# ADR 005: Chinese public holiday off-peak override (Beijing-anchored)

Status: accepted
Date: 2026-10-02

## Context
DeepSeek's documented billing policy states that peak windows apply "Monday
through Friday, excluding Chinese public holidays" — all other hours,
including weekends and Chinese public holidays in full, are off-peak. The
weekend half of this rule was implemented in `docs/ADR-004`; the holiday
half was missing: `config.json` and `src/app.js` had no notion of Chinese
public holidays, so a request during e.g. Spring Festival on a weekday
would have been (incorrectly) priced as peak.

Chinese public holidays are not rule-based like e.g. US federal holidays —
the State Council publishes the following year's exact dates (including
ad-hoc "make-up workday" weekend shifts) by decree, typically in November.
They cannot be computed; they must be looked up.

## Decision
`isPeak(d)` also checks whether `d` falls on a Chinese public holiday in
Beijing time (`Asia/Shanghai`, a fixed UTC+8 offset); if so, the verdict is
off-peak regardless of the UTC window or weekday, exactly like the existing
weekend override. Beijing time is used only as the fixed anchor for *which
calendar day it is*, preserving the ADR-001 property that the verdict is
identical for every visitor at a given instant.

The holiday list is data, not code: `config.json` gains a
`chinaPublicHolidays: { timezone, dates }` field — `dates` is a flat array
of `"YYYY-MM-DD"` Beijing calendar dates — alongside `peakWindows` and
`weekendOffPeak`, following the same "config is the single source of truth
for vendor billing policy" principle as ADR-002/ADR-004. The list is
maintained manually, once a year, from the State Council's published
schedule; there is no attempt to compute or derive it.

China's "make-up workday" weekend shifts (ordinary Saturdays/Sundays
redesignated as working days to offset a holiday) are **not** modeled: our
weekend rule already treats every calendar Saturday/Sunday as off-peak
regardless of China's domestic labor-calendar designation (ADR-004), so a
make-up workday Saturday stays off-peak under the existing weekend rule —
consistent with DeepSeek's own stated policy, which is not tied to China's
labor calendar.

No historical/effective-date modeling: as with ADR-004, the site
implements the holiday rule as the current and only rule.

## Consequences
- `nextTransition`'s lookahead had to grow from 10 to 20 days. The 9-day
  Spring Festival holiday (2026: Feb 15–23) sits directly against its
  preceding Beijing weekend (Feb 14), producing a 10-consecutive-day
  off-peak run; scanning from a "now" just before that run begins requires
  a wider window than the weekend-only case (≤ 3 days) ever needed. 20 days
  leaves headroom for other years' schedules without requiring a reference
  recomputation per release.
- The verify.cjs reference cross-check for `isPeak` gained an
  independently-implemented holiday-date check (a plain `includes` lookup
  against `config.chinaPublicHolidays.dates`, computed from Beijing-local
  date parts) so a shared bug in date computation can't hide behind a
  matching reference, mirroring the existing `isWeekendRef` pattern.
- UI copy that stated the off-peak rule in terms of weekends only (meta
  description, noscript, FAQ, "why do prices change?") needed a holiday
  mention to stay accurate; a dedicated FAQ question was added.
- `config.chinaPublicHolidays.dates` requires a manual update once a year
  when China's next-year schedule is published (typically each November).
  A stale list degrades gracefully to "treat this holiday as a normal
  weekday" rather than failing — same risk profile as any other config
  value falling out of date.

## Verification (cross-check)
- `2026-02-18T07:00:00.000Z` (Wednesday, inside the `06:00-10:00` UTC
  window, and inside the Spring Festival holiday range) → off-peak,
  overridden by the holiday rule despite being a weekday peak-window hour.
- `2026-02-24T07:00:00.000Z` (Tuesday, same UTC clock time, the first
  non-holiday weekday after Spring Festival ends) → peak, confirming the
  override is holiday-specific, not a general UTC-window change.
- `nextTransition` from inside the Feb 14–23 combined weekend+holiday run
  resolves to the first peak window on Feb 24, exercising the extended
  20-day lookahead.
