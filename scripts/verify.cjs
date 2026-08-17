const fs = require("fs");
const vm = require("vm");

const html = fs.readFileSync("dist/index.html", "utf8");
const config = JSON.parse(html.match(/window\.CONFIG = ([\s\S]*?);\n    <\/script>/)[1]);
const app = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];

const elem = () => ({
  className: "",
  textContent: "",
  style: {},
  hidden: false,
  children: [],
  append: () => {},
  replaceChildren: () => {},
  setAttribute: () => {},
  classList: { toggle: () => {} },
  addEventListener: () => {},
  contains: () => false,
  focus: () => {},
  value: "",
});

const context = {
  window: { CONFIG: config },
  Intl,
  Date,
  console,
  document: {
    querySelector: () => elem(),
    createElement: () => elem(),
    addEventListener: () => {},
    documentElement: { setAttribute: () => {} },
  },
  localStorage: { getItem: () => null, setItem: () => {} },
  setInterval: () => 0,
};
vm.createContext(context);

const withExport = app.replace(/\}\)\(\);\s*$/, "window.__t = { pad, toMin, utcDaySec, isPeak, nextTransition, minuteMask, hourFraction, peakRuns, fmtBoundary, localMidnight, countdownText, priceModeText, timelineHourLabel, isNowHour, taglineText }; })();");
vm.runInContext(withExport, context);

const isPeak = context.window.__t.isPeak;
const next = context.window.__t.nextTransition;

const windows = config.peakWindows.map(([a, b]) => [a, b].map((t) => t.split(":").map(Number).reduce((h, m) => h * 60 + m)));
const utcSec = (d) => d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds() + d.getUTCMilliseconds() / 1000;
const ref = (sec) => new Date(Date.UTC(2026, 0, 1) + sec * 1000);
const isPeakRef = (d) => {
  const s = utcSec(d);
  return windows.some(([a, b]) => s >= a * 60 && s < b * 60);
};

let bad = 0;
for (let s = 0; s < 86400; s++) {
  if (isPeakRef(ref(s)) !== isPeak(ref(s))) {
    bad++;
    if (bad < 6) console.log("MISMATCH", s);
  }
}
if (bad) {
  console.log("FAIL:", bad, "second mismatches");
  process.exit(1);
}
console.log("isPeak matches reference across all 86400 seconds ✓");

const cases = [
  [3600, true],
  [3600 * 4 - 1, true],
  [3600 * 4, false],
  [3600 * 6, true],
  [3600 * 10 - 1, true],
  [3600 * 10, false],
  [0, false],
  [3600 * 23 + 3599, false],
];
for (const [sec, expect] of cases) {
  const got = isPeak(ref(sec));
  if (got !== expect) {
    console.log(`FAIL boundary ${sec}s expected ${expect} got ${got}`);
    process.exit(1);
  }
}
console.log("half-open boundary semantics [start,end) ✓");

const t = next(ref(3600 * 5));
const isPeakAt = isPeak(t);
console.log("nextTransition from 05:00 UTC →", t.toISOString().slice(11, 16), "(toPeak:", isPeakAt, ")");
if (!(isPeakAt === true && t.getUTCHours() === 6 && t.getUTCMinutes() === 0)) {
  console.log("FAIL nextTransition");
  process.exit(1);
}
console.log("nextTransition ✓");
console.log("config:", config.models.length, "models,", config.peakWindows.length, "windows");
const site = config.site || {};
if (!site.url || !site.name) {
  console.log("FAIL config.site missing url/name:", JSON.stringify(site));
  process.exit(1);
}
if (!/^https:\/\//.test(site.url)) {
  console.log("FAIL config.site.url must be absolute https:", site.url);
  process.exit(1);
}
console.log("config.site:", site.name, "->", site.url);
const { minuteMask, hourFraction, peakRuns, fmtBoundary, localMidnight } = context.window.__t;
const colomboTz = "Asia/Colombo";
const colomboMid = localMidnight(ref(0), colomboTz);
const colomboMask = minuteMask(ref(0), colomboTz);
const runs = peakRuns(colomboMask);
if (JSON.stringify(runs) !== JSON.stringify([[390, 570], [690, 930]])) {
  console.log("FAIL Colombo peakRuns:", JSON.stringify(runs));
  process.exit(1);
}
if (hourFraction(colomboMask, 6) !== 0.5 || hourFraction(colomboMask, 7) !== 1 || hourFraction(colomboMask, 10) !== 0) {
  console.log("FAIL Colombo hourFraction");
  process.exit(1);
}
const b = (min) => fmtBoundary(colomboMid, colomboTz, min);
if (b(390) !== "06:30" || b(570) !== "09:30" || b(1440) !== "24:00") {
  console.log("FAIL fmtBoundary:", b(390), b(570), b(1440));
  process.exit(1);
}
console.log("Colombo (UTC+5:30) minute mask →", runs.map(([s, e]) => `${b(s)}–${b(e)}`).join(" & "), "✓");

const { countdownText } = context.window.__t;
const cd = (sec, tz = "UTC") => countdownText(ref(sec), tz);
const check = (label, got, want) => {
  if (got !== want) {
    console.log(`FAIL ${label}: got "${got}" want "${want}"`);
    process.exit(1);
  }
};
check("countdown off-peak→peak", cd(5 * 3600), "Next: Peak starts at 06:00 in 1h");
check("countdown peak→off-peak", cd(2 * 3600 + 30 * 60), "Next: Off-peak starts at 04:00 in 1h 30m");
check("countdown <1m edge", cd(6 * 3600 - 30), "Next: Peak starts at 06:00 in <1m");
check("countdown Colombo tz", cd(5 * 3600, "Asia/Colombo"), "Next: Peak starts at 11:30 in 1h");
console.log("countdown text (both states + edge + Col-timezone) ✓");

// DST-transition days: localMidnight must anchor on the real start of the
// local day. The offset at `now` is wrong when the transition has already
// happened by noon (and can oscillate for zones that switch at midnight),
// so the midnight must be derived from instants, not cached offsets.
const dstMid = (iso, tz, utcArgs, label) => {
  const got = localMidnight(new Date(iso), tz);
  const want = Date.UTC(...utcArgs);
  if (got !== want) {
    console.log(`FAIL ${label}: got ${new Date(got).toISOString()} want ${new Date(want).toISOString()}`);
    process.exit(1);
  }
};
dstMid("2026-03-29T12:00:00Z", "Europe/Berlin", [2026, 2, 28, 23], "Berlin spring midnight");
dstMid("2026-03-08T12:00:00Z", "America/New_York", [2026, 2, 8, 5], "US spring midnight");
dstMid("2026-11-01T12:00:00Z", "America/New_York", [2026, 10, 1, 4], "US fall midnight (25h day)");
dstMid("2026-04-24T12:00:00Z", "Africa/Cairo", [2026, 3, 23, 22], "midnight-transition zone");

// Timeline masks on DST days must reflect the real local clock. Berlin is
// CEST after 2026-03-29 02:00 (03:00-06:00 & 08:00-12:00) and CET in winter
// (02:00-05:00 & 07:00-11:00) — the shift falls out of the instants.
// Cross-midnight windows (gotcha): in PDT the 06:00-10:00Z window splits into
// 00:00-03:00 today + 23:00-24:00 today, and the 01:00-04:00Z window of the
// next UTC day lands fully on today evening (18:00-21:00) — never on the
// wrong local date.
const runsText = (iso, tz) => {
  const now = new Date(iso);
  const mid = localMidnight(now, tz);
  return peakRuns(minuteMask(now, tz))
    .map(([s, e]) => `${fmtBoundary(mid, tz, s)}–${fmtBoundary(mid, tz, e)}`)
    .join(" & ");
};
check("Berlin DST day runs", runsText("2026-03-29T12:00:00Z", "Europe/Berlin"), "03:00–06:00 & 08:00–12:00");
check("Berlin winter runs", runsText("2026-01-15T12:00:00Z", "Europe/Berlin"), "02:00–05:00 & 07:00–11:00");
check("PDT cross-midnight runs", runsText("2026-08-15T12:00:00Z", "America/Los_Angeles"), "00:00–03:00 & 18:00–21:00 & 23:00–24:00");
console.log("DST-transition midnights + cross-midnight windows ✓");

const { priceModeText } = context.window.__t;
check("priceMode peak", priceModeText(true), "PEAK");
check("priceMode off-peak", priceModeText(false), "OFF-PEAK");
console.log("pricing mode helper ✓");

const { timelineHourLabel, isNowHour, taglineText } = context.window.__t;
check("timeline label h0", timelineHourLabel(0), "00");
check("timeline label h3", timelineHourLabel(3), "03");
check("timeline label h21", timelineHourLabel(21), "21");
check("timeline label h1 empty", timelineHourLabel(1), "");
check("isNowHour hit", isNowHour(9, 9), true);
check("isNowHour miss", isNowHour(10, 9), false);
check("tagline peak", taglineText(true), "peak");
check("tagline off-peak", taglineText(false), "off-peak");
console.log("timeline label + NOW helpers ✓");
console.log("app script bytes:", app.length);

const themes = ["monokai-pro", "solarized-dark", "tokyo-night", "dracula", "one-dark", "one-light", "solarized-light", "github-light"];
for (const id of themes) {
  const re = new RegExp('\\[data-theme\\s*=\\s*["\']?' + id + '["\']?\\s*\\][^{]{0,10}\\{([^}]*)\\}');
  const m = html.match(re);
  if (!m) {
    console.log("FAIL missing data-theme block:", id);
    process.exit(1);
  }
  const tokens = (m[1].match(/--color-mk-[a-z]+:/g) || []).length;
  if (tokens < 11) {
    console.log("FAIL theme", id, "defines only", tokens, "tokens");
    process.exit(1);
  }
}
console.log("theme override blocks: all", themes.length, "present with full token sets, removed themes absent ✓");

const staticChecks = [
  'id="countdown"',
  'id="taglineChip"',
  'id="priceMode"',
  'data-col="model"',
  'data-col="cacheHit"',
  'data-col="cacheMiss"',
  'data-col="output"',
  "<details",
  "Why do prices change?",
  "Auto-detected from your browser. The verdict is always computed on UTC",
  'id="infoButton"',
  'id="infoDialog"',
  'aria-haspopup="dialog"',
  "showModal",
  "billed at peak (2×)",
  'paypalme/SeekPeak',
  "Support me",
  "text-mk-ink",
];
for (const needle of staticChecks) {
  if (!html.includes(needle)) {
    console.log("FAIL missing static element:", needle);
    process.exit(1);
  }
}
for (const gone of ["gruvbox", "catppuccin-mocha", "kanagawa", "nord", "night-owl", "synthwave-84"]) {
  if (html.includes('data-theme="' + gone + '"')) {
    console.log("FAIL removed theme block still present:", gone);
    process.exit(1);
  }
}
for (const gone of ["clockLocal", "clockTz", "renderClock"]) {
  if (html.includes(gone)) {
    console.log("FAIL clock still present:", gone);
    process.exit(1);
  }
}
console.log("static template: countdown/tagline-chip/price-mode/details/info-dialog present, clock removed ✓");

if (!html.includes('rel="canonical" href="' + site.url + '/"')) {
  console.log("FAIL canonical missing for", site.url);
  process.exit(1);
}
if (!html.includes('property="og:url" content="' + site.url + '/"')) {
  console.log("FAIL og:url missing");
  process.exit(1);
}
if (!html.includes('property="og:image" content="' + site.url + '/og-image.png"')) {
  console.log("FAIL og:image missing");
  process.exit(1);
}
if (!html.includes('name="twitter:card" content="summary_large_image"')) {
  console.log("FAIL twitter:card missing");
  process.exit(1);
}
if (!html.includes('property="og:image:width" content="1200"') || !html.includes('property="og:image:height" content="630"')) {
  console.log("FAIL og:image dimensions missing");
  process.exit(1);
}
if (!html.includes('name="theme-color"')) {
  console.log("FAIL theme-color missing");
  process.exit(1);
}
if (!html.includes("application/ld+json") || !html.includes('"@type": "FAQPage"') || !html.includes('"@type": "WebSite"') || !html.includes("SpeakableSpecification")) {
  console.log("FAIL JSON-LD (FAQPage/WebSite/speakable) missing");
  process.exit(1);
}
if (!html.includes("<noscript>")) {
  console.log("FAIL noscript missing");
  process.exit(1);
}
if (html.includes("__SITE_URL__") || html.includes("__OG_IMAGE_URL__")) {
  console.log("FAIL leftover build token in html");
  process.exit(1);
}
console.log("SEO/GEO head: canonical/OG/Twitter/theme-color/JSON-LD/noscript present, tokens replaced ✓");