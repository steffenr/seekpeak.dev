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

const withExport = app.replace(/\}\)\(\);\s*$/, ";window.__t = { pad, toMin, utcDaySec, isPeak, nextTransition, minuteMask, hourFraction, peakRuns, fmtBoundary, localMidnight, countdownText, priceModeText, timelineHourLabel, isNowHour, taglineText, isWeekend, isChineseHoliday, badgeMsgText }; })();");
vm.runInContext(withExport, context);

const isPeak = context.window.__t.isPeak;
const next = context.window.__t.nextTransition;

const windows = config.peakWindows.map(([a, b]) => [a, b].map((t) => t.split(":").map(Number).reduce((h, m) => h * 60 + m)));
const utcSec = (d) => d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds() + d.getUTCMilliseconds() / 1000;
const ref = (sec) => new Date(Date.UTC(2026, 0, 6) + sec * 1000); // Tuesday — plain weekday, no weekend/holiday override
const weekendCfgForSweep = config.weekendOffPeak;
const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const isWeekendRef = (d) => {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: weekendCfgForSweep.timezone, weekday: "short" }).format(d);
  return weekendCfgForSweep.days.includes(weekdayNames.indexOf(wd));
};
const holidayCfgForSweep = config.chinaPublicHolidays;
const isHolidayRef = (d) => {
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: holidayCfgForSweep.timezone }).format(d); // en-CA -> YYYY-MM-DD
  return holidayCfgForSweep.dates.includes(key);
};
const isPeakRef = (d) => {
  if (isWeekendRef(d) || isHolidayRef(d)) return false;
  const s = utcSec(d);
  return windows.some(([a, b]) => s >= a * 60 && s < b * 60);
};

const sweepStart = Date.UTC(2026, 0, 4); // Sunday, 2026-01-04
let bad = 0;
for (let day = 0; day < 9; day++) {
  for (let s = 0; s < 86400; s++) {
    const d = new Date(sweepStart + day * 86400000 + s * 1000);
    if (isPeakRef(d) !== isPeak(d)) {
      bad++;
      if (bad < 6) console.log("MISMATCH", d.toISOString());
    }
  }
}
if (bad) {
  console.log("FAIL:", bad, "second mismatches");
  process.exit(1);
}
console.log("isPeak matches reference across 9 UTC days (a full Beijing weekend, incl. margin) ✓");

const holidaySweepStart = Date.UTC(2026, 1, 13); // Friday, 2026-02-13 (margin before Spring Festival)
let badHoliday = 0;
for (let day = 0; day < 13; day++) {
  for (let s = 0; s < 86400; s += 7) {
    const d = new Date(holidaySweepStart + day * 86400000 + s * 1000);
    if (isPeakRef(d) !== isPeak(d)) {
      badHoliday++;
      if (badHoliday < 6) console.log("MISMATCH", d.toISOString());
    }
  }
}
if (badHoliday) {
  console.log("FAIL:", badHoliday, "mismatches across Spring Festival + adjacent weekend");
  process.exit(1);
}
console.log("isPeak matches reference across the Spring Festival holiday + adjacent Beijing weekend ✓");

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

const { isWeekend: isWeekendForReason, isChineseHoliday: isChineseHolidayForReason } = context.window.__t;
const reasonFor = (d) => (isWeekendForReason(d) ? "weekend" : isChineseHolidayForReason(d) ? "holiday" : "window");
const verdictCases = JSON.parse(fs.readFileSync("tests/fixtures/verdict-cases.json", "utf8"));
for (const { instant, peak, reason } of verdictCases) {
  const d = new Date(instant);
  const gotPeak = isPeak(d);
  const gotReason = reasonFor(d);
  if (gotPeak !== peak || gotReason !== reason) {
    console.log(`FAIL verdict-cases ${instant}: expected peak=${peak} reason=${reason}, got peak=${gotPeak} reason=${gotReason}`);
    process.exit(1);
  }
}
console.log(`shared verdict-cases.json (${verdictCases.length} cases, incl. weekend/holiday overrides) ✓`);

const t = next(ref(3600 * 5));
const isPeakAt = isPeak(t);
console.log("nextTransition from 05:00 UTC →", t.toISOString().slice(11, 16), "(toPeak:", isPeakAt, ")");
if (!(isPeakAt === true && t.getUTCHours() === 6 && t.getUTCMinutes() === 0)) {
  console.log("FAIL nextTransition");
  process.exit(1);
}
console.log("nextTransition ✓");

const tWeekend = next(new Date("2026-01-03T07:00:00.000Z"));
const wantWeekend = new Date("2026-01-05T01:00:00.000Z");
if (tWeekend.getTime() !== wantWeekend.getTime() || isPeak(tWeekend) !== true) {
  console.log("FAIL nextTransition weekend span: got", tWeekend.toISOString(), "want", wantWeekend.toISOString());
  process.exit(1);
}
console.log("nextTransition spans a full Beijing weekend (Sat mid-window → Mon window start) ✓");

const tHoliday = next(new Date("2026-02-15T07:00:00.000Z")); // Sunday, start of the Feb 14-23 combined weekend+holiday run
const wantHoliday = new Date("2026-02-24T01:00:00.000Z");
if (tHoliday.getTime() !== wantHoliday.getTime() || isPeak(tHoliday) !== true) {
  console.log("FAIL nextTransition holiday span: got", tHoliday.toISOString(), "want", wantHoliday.toISOString());
  process.exit(1);
}
console.log("nextTransition spans the combined weekend+Spring Festival run (20-day lookahead) ✓");

// Worst case: "now" on the UTC calendar day (Feb 13) before the run starts,
// so the day-0 anchor is 11 days short of the Feb 24 resumption — this is
// the scenario that overflowed the old 10-day lookahead (ADR-005).
const tWorst = next(new Date("2026-02-13T23:00:00.000Z"));
if (tWorst.getTime() !== wantHoliday.getTime() || isPeak(tWorst) !== true) {
  console.log("FAIL nextTransition worst-case lookahead: got", tWorst.toISOString(), "want", wantHoliday.toISOString());
  process.exit(1);
}
console.log("nextTransition 20-day lookahead covers the Feb-13-anchor worst case ✓");

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

const weekendCfg = config.weekendOffPeak || {};
if (!weekendCfg.timezone || !Array.isArray(weekendCfg.days) || weekendCfg.days.length === 0) {
  console.log("FAIL config.weekendOffPeak missing timezone/days:", JSON.stringify(weekendCfg));
  process.exit(1);
}
console.log("config.weekendOffPeak:", weekendCfg.timezone, weekendCfg.days);

const holidayCfg = config.chinaPublicHolidays || {};
if (!holidayCfg.timezone || !Array.isArray(holidayCfg.dates) || holidayCfg.dates.length === 0) {
  console.log("FAIL config.chinaPublicHolidays missing timezone/dates:", JSON.stringify(holidayCfg));
  process.exit(1);
}
if (!holidayCfg.dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))) {
  console.log("FAIL config.chinaPublicHolidays.dates must be YYYY-MM-DD strings:", JSON.stringify(holidayCfg.dates));
  process.exit(1);
}
console.log("config.chinaPublicHolidays:", holidayCfg.timezone, holidayCfg.dates.length, "dates");

const { isWeekend, isChineseHoliday } = context.window.__t;
const holidayCases = [
  ["2026-02-14T15:59:59.999Z", false, "Sat 23:59:59.999 Beijing (day before Spring Festival starts)"],
  ["2026-02-14T16:00:00.000Z", true, "Sun 00:00:00.000 Beijing (Spring Festival begins)"],
  ["2026-02-23T15:59:59.999Z", true, "Mon 23:59:59.999 Beijing (last instant of Spring Festival)"],
  ["2026-02-23T16:00:00.000Z", false, "Tue 00:00:00.000 Beijing (Spring Festival ends)"],
];
for (const [iso, expect, label] of holidayCases) {
  const got = isChineseHoliday(new Date(iso));
  if (got !== expect) {
    console.log(`FAIL isChineseHoliday ${label}: expected ${expect} got ${got}`);
    process.exit(1);
  }
}
console.log("isChineseHoliday Beijing-anchored boundaries ✓");
const weekendCases = [
  ["2026-01-02T15:59:59.999Z", false, "Fri 23:59:59.999 Beijing"],
  ["2026-01-02T16:00:00.000Z", true, "Sat 00:00:00.000 Beijing"],
  ["2026-01-04T15:59:59.999Z", true, "Sun 23:59:59.999 Beijing"],
  ["2026-01-04T16:00:00.000Z", false, "Mon 00:00:00.000 Beijing"],
];
for (const [iso, expect, label] of weekendCases) {
  const got = isWeekend(new Date(iso));
  if (got !== expect) {
    console.log(`FAIL isWeekend ${label}: expected ${expect} got ${got}`);
    process.exit(1);
  }
}
console.log("isWeekend Beijing-anchored boundaries ✓");

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
check("countdown multi-day (weekend span)", cd(3 * 86400 + 10 * 3600 + 13 * 60), "Next: Peak starts at 01:00 in 2d 14h 47m");
console.log("countdown text (both states + edge + Col-timezone + multi-day) ✓");

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

// Timeline masks on DST days must reflect the real local clock — the shift
// falls out of the instants, not a hardcoded offset. Berlin is CET in winter
// (02:00-05:00 & 07:00-11:00, checked below).
// Cross-midnight windows (gotcha): in PDT the 06:00-10:00Z window splits into
// 00:00-03:00 today + 23:00-24:00 today, and the 01:00-04:00Z window of the
// next UTC day lands fully on today evening (18:00-21:00) — never on the
// wrong local date.
// 2026-03-29 (Berlin's spring-forward date) is also a Sunday, so this Berlin
// calendar day now falls under the Beijing-weekend override and is correctly
// all-off-peak — hence the expected value below is "", not a CEST peak-run
// string. The DST offset-jump assertion further below covers the CET→CEST
// math independently of the weekend override.
const runsText = (iso, tz) => {
  const now = new Date(iso);
  const mid = localMidnight(now, tz);
  return peakRuns(minuteMask(now, tz))
    .map(([s, e]) => `${fmtBoundary(mid, tz, s)}–${fmtBoundary(mid, tz, e)}`)
    .join(" & ");
};
check("Berlin DST day runs", runsText("2026-03-29T12:00:00Z", "Europe/Berlin"), "");
check("Berlin winter runs", runsText("2026-01-15T12:00:00Z", "Europe/Berlin"), "02:00–05:00 & 07:00–11:00");

// The weekend override zeroes out the peak-run fixture above, so recover
// signal on the underlying CET→CEST offset jump directly: Berlin's local
// day is 23h long on its spring-forward date, independent of which weekday
// it falls on.
const berlinDstDayMs =
  localMidnight(new Date("2026-03-30T12:00:00Z"), "Europe/Berlin") -
  localMidnight(new Date("2026-03-29T12:00:00Z"), "Europe/Berlin");
if (berlinDstDayMs !== 23 * 3600 * 1000) {
  console.log("FAIL Berlin DST day length: got", berlinDstDayMs / 3600000, "hours, want 23");
  process.exit(1);
}
console.log("Berlin spring-forward day is 23h ✓");

check("PDT cross-midnight runs", runsText("2026-08-13T12:00:00Z", "America/Los_Angeles"), "00:00–03:00 & 18:00–21:00 & 23:00–24:00");
console.log("DST-transition midnights + cross-midnight windows ✓");

const { priceModeText } = context.window.__t;
check("priceMode peak", priceModeText(true), "PEAK");
check("priceMode off-peak", priceModeText(false), "OFF-PEAK");
console.log("pricing mode helper ✓");

const { badgeMsgText } = context.window.__t;
check("badgeMsgText peak", badgeMsgText(true, false), "Your next request right now is billed at peak rates.");
check("badgeMsgText off-peak", badgeMsgText(false, false), "Your next request right now is billed at off-peak rates.");
check("badgeMsgText weekend", badgeMsgText(false, true, false), "It's the weekend in Beijing — DeepSeek bills every request at the off-peak rate right now, no matter the hour.");
check("badgeMsgText holiday", badgeMsgText(false, false, true), "It's a Chinese public holiday — DeepSeek bills every request at the off-peak rate right now, no matter the hour.");
console.log("badge message helper (peak/off-peak/weekend/holiday) ✓");

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
  "Are weekends billed differently?",
  "Since August 23, 2026, DeepSeek bills weekends",
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

const png = fs.readFileSync("dist/og-image.png");
const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
for (let i = 0; i < sig.length; i++) {
  if (png[i] !== sig[i]) {
    console.log("FAIL og-image.png bad PNG signature at byte", i);
    process.exit(1);
  }
}
console.log("og-image.png valid PNG ✓");

const pngSig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const isPng = (p) => {
  const b = fs.readFileSync("dist/" + p);
  return b.length > pngSig.length && pngSig.every((v, i) => b[i] === v);
};
for (const icon of ["favicon-96x96.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png"]) {
  if (!isPng(icon)) {
    console.log("FAIL", icon, "missing or bad PNG signature");
    process.exit(1);
  }
}
const ico = fs.readFileSync("dist/favicon.ico");
if (!(ico[0] === 0 && ico[1] === 0 && ico[2] === 1 && ico[3] === 0)) {
  console.log("FAIL favicon.ico missing or bad ICO header");
  process.exit(1);
}
console.log("favicon + PWA icons present with valid signatures ✓");

for (const link of [
  'rel="icon" href="/favicon.ico"',
  'rel="icon" type="image/png" sizes="96x96" href="/favicon-96x96.png"',
  'rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"',
  'rel="manifest" href="/site.webmanifest"',
]) {
  if (!html.includes(link)) {
    console.log("FAIL missing head link:", link);
    process.exit(1);
  }
}
if (html.includes("data:image/svg+xml") || html.includes('rel="icon" href=\'data:')) {
  console.log("FAIL inline SVG favicon still present");
  process.exit(1);
}
console.log("head favicon/apple-touch-icon/manifest links present, SVG data-URI favicon removed ✓");

const manifestRaw = fs.readFileSync("dist/site.webmanifest", "utf8");
const manifest = JSON.parse(manifestRaw);
if (manifest.name !== site.name || manifest.short_name !== site.name) {
  console.log("FAIL manifest name mismatch:", manifest.name, "/", manifest.short_name, "vs", site.name);
  process.exit(1);
}
if (manifest.start_url !== site.url + "/") {
  console.log("FAIL manifest start_url:", manifest.start_url, "expected", site.url + "/");
  process.exit(1);
}
if (manifest.theme_color !== "#2d2a2e" || manifest.background_color !== "#2d2a2e") {
  console.log("FAIL manifest theme/background colors:", manifest.theme_color, manifest.background_color);
  process.exit(1);
}
for (const icon of manifest.icons) {
  const rel = icon.src.replace(/^\//, "");
  if (!fs.existsSync("dist/" + rel)) {
    console.log("FAIL manifest references missing icon:", icon.src);
    process.exit(1);
  }
}
if (manifestRaw.includes("__SITE_NAME__") || manifestRaw.includes("__SITE_URL__")) {
  console.log("FAIL leftover build token in site.webmanifest");
  process.exit(1);
}
console.log("site.webmanifest valid JSON, brand from config, icons exist, no leftover tokens ✓");

const robots = fs.readFileSync("dist/robots.txt", "utf8");
if (!robots.includes("Allow: /")) {
  console.log("FAIL robots.txt content");
  process.exit(1);
}
if (robots.includes("Sitemap:")) {
  console.log("FAIL robots.txt should not reference a sitemap (single-page site)");
  process.exit(1);
}
if (fs.existsSync("dist/sitemap.xml")) {
  console.log("FAIL dist/sitemap.xml should not exist (single-page site, no sitemap)");
  process.exit(1);
}
console.log("robots.txt present, no sitemap.xml ✓");

const appSrc = fs.readFileSync("src/app.js", "utf8");
if (app.length >= appSrc.length) {
  console.log("FAIL inlined app.js not minified (", app.length, ">= src", appSrc.length, ")");
  process.exit(1);
}
console.log("inlined app.js minified:", appSrc.length, "->", app.length, "bytes ✓");
const AFF = "https://agentrouter.org/register?aff=ENwt";
const OFFERS = JSON.parse(fs.readFileSync("credits.json", "utf8")).offers;

if (html.includes('href="/agentrouter/"')) {
  console.log("FAIL main page should no longer link to /agentrouter/ (page removed)");
  process.exit(1);
}
if (!html.includes('href="/free-credits/"')) {
  console.log("FAIL main page footer missing the free-credits link");
  process.exit(1);
}
if (html.includes('id="creditCta"')) {
  console.log("FAIL main page should no longer have the prominent free-credits CTA block");
  process.exit(1);
}
if (html.includes('href="/omp/"')) {
  console.log("FAIL main page should no longer link to /omp/ (page removed)");
  process.exit(1);
}

const fc = fs.readFileSync("dist/free-credits/index.html", "utf8");
for (const needle of [
  'id="freeCreditsTitle"',
  AFF,
  'rel="noopener sponsored"',
  'id="freeCreditsIntro"',
  "Working offers",
  "How this list works",
  'id="themeButton"',
]) {
  if (!fc.includes(needle)) {
    console.log("FAIL free-credits page missing:", needle);
    process.exit(1);
  }
}
// Every provider in credits.json is on the page and in the gist, with its models.
const gist = fs.readFileSync("free-credits.gist.md", "utf8");
for (const o of OFFERS) {
  for (const [label, src] of [["free-credits page", fc], ["free-credits.gist.md", gist]]) {
    if (!src.includes(o.provider)) {
      console.log("FAIL", label, "missing provider:", o.provider);
      process.exit(1);
    }
    for (const m of o.models) {
      if (!src.includes(m)) {
        console.log("FAIL", label, "missing model", m, "for", o.provider);
        process.exit(1);
      }
    }
  }
}
if (!fc.includes('rel="canonical" href="' + site.url + '/free-credits/"') || !fc.includes('property="og:url" content="' + site.url + '/free-credits/"')) {
  console.log("FAIL free-credits canonical/og:url missing");
  process.exit(1);
}
if (!fc.includes('"@type": "FAQPage"') || !fc.includes('"@type": "WebPage"')) {
  console.log("FAIL free-credits JSON-LD missing");
  process.exit(1);
}
if (fc.includes("__SITE_URL__") || fc.includes("__OG_IMAGE_URL__") || /\/\*__(CSS|SUB_APP)__\*\//.test(fc)) {
  console.log("FAIL leftover build token in free-credits page");
  process.exit(1);
}
if (!html.includes('href="/free-credits/"')) {
  console.log("FAIL main page does not link to /free-credits/");
  process.exit(1);
}
const fcApp = [...fc.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
// The sub-page bundle must ship the same theme list as the homepage (src/themes.js is prepended to both).
for (const [name, src] of [["index", app], ["free-credits", fcApp]]) {
  for (const id of themes) {
    if (!src.includes('"' + id + '"')) {
      console.log("FAIL", name, "bundle missing theme id:", id);
      process.exit(1);
    }
  }
}
if (!fcApp.includes("deepseek-peak-theme")) {
  console.log("FAIL free-credits bundle does not use the shared theme storage key");
  process.exit(1);
}
const subSrc = fs.readFileSync("src/themes.js", "utf8") + fs.readFileSync("src/subpage.js", "utf8");
if (fcApp.length >= subSrc.length) {
  console.log("FAIL inlined subpage.js not minified (", fcApp.length, ">= src", subSrc.length, ")");
  process.exit(1);
}
console.log(`free-credits page + gist: all ${OFFERS.length} providers from credits.json with their models, SEO head, minified: ${subSrc.length} -> ${fcApp.length} bytes ✓`);

// Every page footer carries the repo link (icon-only <a> to the source on GitHub).
for (const [name, src] of [["index", html], ["free-credits", fc]]) {
  if (!src.includes('href="https://github.com/steffenr/seekpeak.dev"')) {
    console.log("FAIL", name, "footer missing the GitHub repo link");
    process.exit(1);
  }
}
console.log("every page footer links the GitHub repo ✓");
