(() => {
  "use strict";

  const CONFIG = window.CONFIG;
  const WINDOWS = CONFIG.peakWindows;
  const WEEKEND = CONFIG.weekendOffPeak;

  const $ = (sel) => document.querySelector(sel);
  const pad = (n) => String(n).padStart(2, "0");
  const toMin = (t) => t.split(":").map(Number).reduce((h, m) => h * 60 + m);

  const DETECTED = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  })();

  const state = { tz: DETECTED, manual: false, peak: null };

  const THEMES = [
    { id: "monokai-pro", label: "Monokai Pro", swatches: ["#fcfcfa", "#ffd866", "#ff6188", "#78dce8", "#a9dc76"] },
    { id: "solarized-dark", label: "Solarized Dark", swatches: ["#93a1a1", "#b58900", "#d33682", "#2aa198", "#859900"] },
    { id: "tokyo-night", label: "Tokyo Night", swatches: ["#c0caf5", "#e0af68", "#f7768e", "#7aa2f7", "#9ece6a"] },
    { id: "dracula", label: "Dracula", swatches: ["#f8f8f2", "#f1fa8c", "#ff79c6", "#8be9fd", "#50fa7b"] },
    { id: "one-dark", label: "One Dark", swatches: ["#abb2bf", "#e5c07b", "#e06c75", "#56b6c2", "#98c379"] },
    { id: "one-light", label: "One Light", swatches: ["#383a42", "#e5c07b", "#e45649", "#6bb4f5", "#50a14f"] },
    { id: "solarized-light", label: "Solarized Light", swatches: ["#586e75", "#b58900", "#e066a7", "#2aa198", "#859900"] },
    { id: "github-light", label: "GitHub Light", swatches: ["#1f2328", "#d4a72c", "#e05b63", "#5ba1ef", "#37a254"] },
  ];

  const THEME_KEY = "deepseek-peak-theme";
  const THEME_DEFAULT = "monokai-pro";
  let theme = (() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      return THEMES.some((t) => t.id === stored) ? stored : THEME_DEFAULT;
    } catch {
      return THEME_DEFAULT;
    }
  })();
  document.documentElement.setAttribute("data-theme", theme);

  function utcDaySec(d) {
    return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds() + d.getUTCMilliseconds() / 1000;
  }

  function isPeak(d) {
    if (isWeekend(d)) return false;
    const s = utcDaySec(d);
    return WINDOWS.some(([a, b]) => {
      const sa = toMin(a) * 60;
      const sb = toMin(b) * 60;
      return s >= sa && s < sb;
    });
  }

  function nextTransition(now) {
    const v0 = isPeak(now);
    const day0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const boundaryMin = [];
    for (const [a, b] of WINDOWS) boundaryMin.push(toMin(a), toMin(b));
    const candidates = [];
    for (let day = 0; day <= 9; day++) {
      for (const m of boundaryMin) candidates.push(day0 + day * 86400000 + m * 60000);
    }
    candidates.sort((a, b) => a - b);
    for (const t of candidates) {
      if (t > now.getTime() && isPeak(new Date(t)) !== v0) return new Date(t);
    }
    return null;
  }

  function partsInTz(d, tz, opts) {
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", ...opts }).formatToParts(d);
    } catch {
      return new Intl.DateTimeFormat("en-US", { hourCycle: "h23", ...opts }).formatToParts(d);
    }
  }

  function part(d, tz, type, opts) {
    const p = partsInTz(d, tz, opts).find((x) => x.type === type);
    return p ? p.value : "";
  }

  function tzOffsetMin(tz, d) {
    const v = part(d, tz, "timeZoneName", { timeZoneName: "longOffset" });
    const m = /GMT([+-])(\d{1,2}):?(\d{2})?/.exec(v);
    if (!m) return 0;
    return (m[1] === "-" ? -1 : 1) * (parseInt(m[2], 10) * 60 + parseInt(m[3] || "0", 10));
  }

  function offsetLabel(tz, d) {
    const m = tzOffsetMin(tz, d);
    if (m === 0) return "UTC";
    const sign = m < 0 ? "-" : "+";
    const a = Math.abs(m);
    return "UTC" + sign + Math.floor(a / 60) + (a % 60 ? ":" + pad(a % 60) : "");
  }

  function tzDateParts(d, tz) {
    const opts = { year: "numeric", month: "2-digit", day: "2-digit" };
    return {
      y: parseInt(part(d, tz, "year", opts), 10),
      mo: parseInt(part(d, tz, "month", opts), 10) - 1,
      d: parseInt(part(d, tz, "day", opts), 10),
    };
  }

  function isWeekend(d) {
    const { y, mo, d: dd } = tzDateParts(d, WEEKEND.timezone);
    const day = new Date(Date.UTC(y, mo, dd)).getUTCDay();
    return WEEKEND.days.includes(day);
  }

  function localMidnight(d, tz) {
    const { y, mo, d: dd } = tzDateParts(d, tz);
    const utcMid = Date.UTC(y, mo, dd);
    // A zone carries at most two offsets on a date (DST transition); the
    // offset at `d` is unreliable on transition days, so collect the offsets
    // seen around UTC midnight of the target date and keep the earliest
    // candidate whose local date matches (this also covers zones that switch
    // exactly at local midnight, where offset iteration can oscillate).
    const offsets = [...new Set([-12, 0, 12].map((h) => tzOffsetMin(tz, new Date(utcMid + h * 3600e3))))];
    let best = null;
    for (const off of offsets) {
      const cand = utcMid - off * 60000;
      const l = tzDateParts(new Date(cand), tz);
      if (l.y === y && l.mo === mo && l.d === dd && (best === null || cand < best)) best = cand;
    }
    return best;
  }

  function localHour(d, tz) {
    return parseInt(part(d, tz, "hour", { hour: "2-digit" }), 10);
  }

  const fmtPrice = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 });

  function tzList() {
    let names;
    try {
      names = Intl.supportedValuesOf("timeZone");
    } catch {
      names = ["UTC"];
    }
    const now = new Date();
    const seen = new Set();
    const out = [];
    for (const n of names) {
      if (seen.has(n)) continue;
      seen.add(n);
      out.push({ id: n, offset: tzOffsetMin(n, now) });
    }
    return out.sort((a, b) => a.offset - b.offset || a.id.localeCompare(b.id));
  }

  function minuteMask(now, tz) {
    const mid = localMidnight(now, tz);
    const arr = new Array(1440);
    for (let m = 0; m < 1440; m++) arr[m] = isPeak(new Date(mid + m * 60000));
    return arr;
  }

  function hourFraction(mask, h) {
    const start = h * 60;
    let count = 0;
    for (let m = start; m < start + 60; m++) if (mask[m]) count++;
    return count / 60;
  }

  function peakRuns(mask) {
    const out = [];
    let s = null;
    for (let m = 0; m <= 1440; m++) {
      const p = mask[m] === true;
      if (p && s === null) s = m;
      if (!p && s !== null) {
        out.push([s, m]);
        s = null;
      }
    }
    return out;
  }

  function fmtBoundary(mid, tz, min) {
    if (min >= 1440) return "24:00";
    const d = new Date(mid + min * 60000);
    const opts = { hour: "2-digit", minute: "2-digit" };
    return `${part(d, tz, "hour", opts)}:${part(d, tz, "minute", opts)}`;
  }

  function countdownText(now, tz) {
    const t = nextTransition(now);
    if (!t || t.getTime() <= now.getTime()) return "";
    // hour must be requested too, else ICU pads minute as "0" not "00"
    const hmOpts = { hour: "2-digit", minute: "2-digit" };
    const time = `${part(t, tz, "hour", hmOpts)}:${part(t, tz, "minute", hmOpts)}`;
    const totalMin = Math.floor((t.getTime() - now.getTime()) / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    const dur = h > 0 && m > 0 ? `${h}h ${m}m` : h > 0 ? `${h}h` : m > 0 ? `${m}m` : "<1m";
    return `Next: ${isPeak(now) ? "Off-peak" : "Peak"} starts at ${time} in ${dur}`;
  }

  const countdownEl = $("#countdown");
  const taglineChip = $("#taglineChip");
  const badgeDot = $("#badgeDot");
  const badgeText = $("#badgeText");
  const badgeMsg = $("#badgeMsg");
  const badgeCard = $("#badgeCard");
  const tzLabel = $("#tzLabel");
  const tzAuto = $("#tzAuto");
  const tzButton = $("#tzButton");
  const tzPanel = $("#tzPanel");
  const tzSearch = $("#tzSearch");
  const tzListEl = $("#tzList");
  const timeline = $("#timeline");
  const blocksLine = $("#blocksLine");
  const priceBody = $("#priceBody");
  const themeButton = $("#themeButton");
  const themePanel = $("#themePanel");
  const themeList = $("#themeList");
  const themePillLabel = $("#themePillLabel");

  const OFFCHIP = "border border-black bg-mk-green text-mk-ink shadow-[1px_1px_0px_0px_#000000]";
  const PEAKCHIP = "border border-black bg-mk-yellow text-mk-ink shadow-[1px_1px_0px_0px_#000000]";
  const DIM = "border border-black bg-mk-input text-mk-muted";

  function renderBadge(now) {
    const peak = isPeak(now);
    state.peak = peak;
    const els = peak
      ? {
          card: "bg-mk-yellow",
          text: "PEAK TIME",
          msg: "Your next request right now is billed at peak rates.",
          dot: "bg-mk-pink",
          fg: "text-mk-badge-peak",
        }
      : {
          card: "bg-mk-green",
          text: "OFF-PEAK TIME",
          msg: "Your next request right now is billed at off-peak rates.",
          dot: "bg-mk-cyan",
          fg: "text-mk-badge-off",
        };
    badgeDot.className = "h-4 w-4 rounded-sm border-2 border-black shadow-[2px_2px_0px_0px_#000000] " + els.dot;
    badgeText.textContent = els.text;
    badgeMsg.textContent = els.msg;
    badgeText.className = "text-2xl font-black uppercase tracking-tight sm:text-3xl " + els.fg;
    badgeMsg.className = "mt-2 text-sm font-bold " + els.fg;
    badgeCard.className =
      "rounded-md border-2 border-black p-6 text-center shadow-[6px_6px_0px_0px_#000000] " + els.card;
  }

  function priceModeText(peak) {
    return peak ? "PEAK" : "OFF-PEAK";
  }

  const priceMode = $("#priceMode");

  function renderPriceMode(now) {
    const peak = isPeak(now);
    priceMode.textContent = priceModeText(peak);
    priceMode.className =
      "px-1.5 py-0.5 text-xs font-black uppercase tracking-wide text-mk-ink " +
      (peak ? "bg-mk-yellow" : "bg-mk-green");
  }

  function taglineText(peak) {
    return peak ? "peak" : "off-peak";
  }

  function renderTagline(now) {
    const peak = isPeak(now);
    taglineChip.textContent = taglineText(peak);
    taglineChip.className = "px-1 text-mk-ink " + (peak ? "bg-mk-pink" : "bg-mk-green");
  }

  function renderCountdown(now) {
    const peak = isPeak(now);
    countdownEl.textContent = countdownText(now, state.tz);
    countdownEl.className =
      "mt-3 text-sm font-black uppercase tracking-wide " +
      (peak ? "text-mk-badge-peak" : "text-mk-badge-off");
  }

  function timelineHourLabel(h) {
    return h % 3 === 0 ? pad(h) : "";
  }

  function isNowHour(h, nowH) {
    return h === nowH;
  }

  function renderTimeline(now) {
    const mid = localMidnight(now, state.tz);
    const mask = minuteMask(now, state.tz);
    const nowH = localHour(now, state.tz);
    timeline.replaceChildren();
    for (let h = 0; h < 24; h++) {
      const col = document.createElement("div");
      col.className = "flex min-w-0 flex-1 flex-col items-center gap-1 px-0.5";
      const isNow = isNowHour(h, nowH);
      const pct = Math.round(hourFraction(mask, h) * 100);
      const frame = document.createElement("div");
      frame.className =
        "relative h-6 w-full overflow-hidden border-2 border-black bg-mk-input" +
        (isNow ? " ring-2 ring-mk-cyan" : "");
      const fill = document.createElement("div");
      fill.className = "absolute inset-x-0 bottom-0 bg-mk-orange";
      fill.style.height = pct + "%";
      frame.title = `${pad(h)}:00 · ${pct}% peak`;
      const mark = document.createElement("span");
      mark.className =
        "flex h-[8px] items-center leading-none text-[8px] font-black" +
        (isNow ? " text-mk-cyan" : " text-transparent");
      mark.textContent = isNow ? "NOW" : "\u00A0";
      const lab = document.createElement("span");
      lab.className =
        "text-[9px] font-black leading-none" +
        (isNow ? " text-mk-cyan" : " text-mk-muted") +
        (timelineHourLabel(h) ? "" : " text-transparent");
      lab.textContent = timelineHourLabel(h) || "\u00A0";
      frame.append(fill);
      col.append(mark, frame, lab);
      timeline.append(col);
    }
    const runs = peakRuns(mask);
    blocksLine.textContent = runs.length
      ? runs.map(([s, e]) => `${fmtBoundary(mid, state.tz, s)}–${fmtBoundary(mid, state.tz, e)}`).join(" & ")
      : "no peak block today in your local clock";
  }

  function renderPriceTable() {
    const peak = state.peak;
    priceBody.replaceChildren();
    for (const m of CONFIG.models) {
      const tr = document.createElement("tr");
      tr.className = "border-t-2 border-black";
      const name = document.createElement("td");
      name.className = "px-4 py-3 pr-4 font-black text-mk-cyan";
      name.textContent = m.id;
      tr.append(name);
      const keys = [
        ["cacheHit", "Input · cache hit"],
        ["cacheMiss", "Input · cache miss"],
        ["output", "Output"],
      ];
      for (const [key] of keys) {
        const td = document.createElement("td");
        td.className = "px-4 py-3 pr-4";
        const wrap = document.createElement("div");
        wrap.className = "flex flex-col items-start gap-1.5";
        for (const kind of ["offPeak", "peak"]) {
          const chip = document.createElement("span");
          const active = peak ? kind === "peak" : kind === "offPeak";
          chip.className =
            "rounded-md px-2 py-0.5 text-sm font-bold tabular-nums transition-all " +
            (active ? (kind === "peak" ? PEAKCHIP : OFFCHIP) : DIM) +
            (active ? " ring-2 ring-black" : "");
          chip.textContent = fmtPrice(m[key][kind]);
          wrap.append(chip);
        }
        td.append(wrap);
        tr.append(td);
      }
      priceBody.append(tr);
    }
  }

  function renderTzLabel(now) {
    tzLabel.textContent = `${state.tz} · ${offsetLabel(state.tz, now)}`;
    tzAuto.classList.toggle("hidden", state.manual || state.tz !== DETECTED);
  }

  function renderTzList() {
    const list = tzList();
    tzListEl.replaceChildren();
    for (const t of list) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "flex w-full items-center justify-between border-b-2 border-black px-3 py-2 text-left text-sm font-bold uppercase tracking-wide transition-all last:border-b-0 " +
        (t.id === state.tz
          ? "bg-mk-yellow text-mk-ink"
          : "text-mk-fg hover:translate-x-[2px] hover:bg-mk-yellow/30") +
        " active:translate-x-[2px] active:bg-mk-yellow";
      const name = document.createElement("span");
      name.textContent = t.id;
      const off = document.createElement("span");
      off.className = "text-xs font-bold text-mk-muted";
      off.textContent = offsetLabel(t.id, new Date());
      btn.append(name, off);
      btn.addEventListener("click", () => {
        state.tz = t.id;
        state.manual = true;
        closePanel();
        fullRender();
      });
      li.append(btn);
      tzListEl.append(li);
    }
  }

  function openPanel() {
    tzPanel.hidden = false;
    tzSearch.value = "";
    renderTzList();
    tzSearch.focus();
    tzButton.setAttribute("aria-expanded", "true");
  }

  function closePanel() {
    tzPanel.hidden = true;
    tzButton.setAttribute("aria-expanded", "false");
  }

  function renderThemeList() {
    themeList.replaceChildren();
    for (const t of THEMES) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "flex w-full items-center justify-between border-b-2 border-black px-3 py-2 text-left text-sm font-bold uppercase tracking-wide transition-all last:border-b-0 " +
        (t.id === theme
          ? "bg-mk-yellow text-mk-ink"
          : "text-mk-fg hover:translate-x-[2px] hover:bg-mk-yellow/30") +
        " active:translate-x-[2px] active:bg-mk-yellow";
      const name = document.createElement("span");
      name.textContent = t.label;
      const sw = document.createElement("span");
      sw.className = "flex gap-1";
      for (const c of t.swatches) {
        const dot = document.createElement("span");
        dot.className = "h-3 w-3 border border-black";
        dot.style.backgroundColor = c;
        sw.append(dot);
      }
      btn.append(name, sw);
      btn.addEventListener("click", () => {
        theme = t.id;
        document.documentElement.setAttribute("data-theme", theme);
        try {
          localStorage.setItem(THEME_KEY, theme);
        } catch (e) {}
        renderThemePill();
        renderThemeList();
        closeThemePanel();
      });
      li.append(btn);
      themeList.append(li);
    }
  }

  function renderThemePill() {
    const current = THEMES.find((t) => t.id === theme) || THEMES[0];
    themePillLabel.textContent = current.label;
  }

  function openThemePanel() {
    themePanel.hidden = false;
    renderThemeList();
    themeButton.setAttribute("aria-expanded", "true");
  }

  function closeThemePanel() {
    themePanel.hidden = true;
    themeButton.setAttribute("aria-expanded", "false");
  }

  function fullRender() {
    const now = new Date();
    renderPriceMode(now);
    renderBadge(now);
    renderTagline(now);
    renderCountdown(now);
    renderTimeline(now);
    renderPriceTable();
    renderTzLabel(now);
  }

  tzButton.addEventListener("click", (e) => {
    e.stopPropagation();
    tzPanel.hidden ? openPanel() : closePanel();
  });

  tzSearch.addEventListener("input", () => {
    const q = tzSearch.value.trim().toLowerCase();
    for (const li of tzListEl.children) {
      li.style.display = q && !li.textContent.toLowerCase().includes(q) ? "none" : "";
    }
  });

  document.addEventListener("click", (e) => {
    if (!tzPanel.hidden && !tzPanel.contains(e.target) && e.target !== tzButton) closePanel();
  });

  themeButton.addEventListener("click", (e) => {
    e.stopPropagation();
    themePanel.hidden ? openThemePanel() : closeThemePanel();
  });

  const infoButton = $("#infoButton");
  const infoDialog = $("#infoDialog");
  infoButton.addEventListener("click", () => infoDialog.showModal());

  document.addEventListener("click", (e) => {
    if (!themePanel.hidden && !themePanel.contains(e.target) && e.target !== themeButton) closeThemePanel();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closePanel();
      closeThemePanel();
    }
  });

  renderTzList();
  renderThemeList();
  renderThemePill();
  fullRender();

  let lastPeak = state.peak;
  setInterval(() => {
    const now = new Date();
    renderCountdown(now);
    const peak = isPeak(now);
    if (peak !== lastPeak) {
      lastPeak = peak;
      renderBadge(now);
      renderTagline(now);
      renderPriceMode(now);
      renderPriceTable();
      renderTimeline(now);
    }
  }, 1000);
})();
