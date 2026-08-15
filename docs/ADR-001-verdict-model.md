# ADR 001: Verdict is UTC-global; timezone is display-only

Status: accepted
Date: 2026-08-14

## Context
The site must tell a visitor whether "now" is DeepSeek peak or off-peak, and
show model pricing accordingly. Peak windows are defined in UTC
(01:00-04:00 and 06:00-10:00). The visitor timezone is detected and
selectable. A naive reading could interpret peak per-visitor (local clock),
which would mark different verdicts for different users at the same instant.

## Decision
The verdict is computed on **UTC now** — the same for every visitor at any
instant. The visitor timezone is used only to *re-render* clocks: local
time, local projection of the peak blocks, and the next-transition time.
A timezone never changes the price, only the clock it is read on.

Detection: `Intl.DateTimeFormat().resolvedOptions().timeZone`, pre-filled
into a user-selectable, custom-styled selector.

## Consequences
- Two visitors landing at the same instant always see the same verdict.
- The displayed per-timezone peak blocks (e.g. CEST 03:00-06:00 &
  08:00-12:00, PDT 18:00-21:00 & 23:00-03:00) are derived at runtime via
  `Intl` — never hardcoded.
- The badge copy is instant-scoped: peak shows "Your next request right now
  is billed at peak rates." (and the off-peak analog). That the verdict is
  identical for everyone is structural — it follows from computing on UTC —
  and is restated in the JSON-LD FAQ ("Does Seek Peak use my timezone?").

## Verification (cross-check)
- 01:00-04:00 UTC == CEST 03:00-06:00 == PDT 18:00-21:00 (prev day)
- 06:00-10:00 UTC == CEST 08:00-12:00 == PDT 23:00-03:00