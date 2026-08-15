const fs = require("fs");
const html = fs.readFileSync("dist/index.html", "utf8");
const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] || "";

const LIGHT = ["one-light", "solarized-light", "github-light"];

function lum(hex) {
  const c = hex.replace("#", "").slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  const f = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

let fails = 0;
for (const id of LIGHT) {
  const block = css.match(new RegExp(`\\[data-theme=${id}\\][^{]*\\{([^}]*)\\}`))?.[1];
  if (!block) {
    console.log(`FAIL no css block for ${id}`);
    fails++;
    continue;
  }
  const t = {};
  for (const [, k, v] of block.matchAll(/--color-mk-([a-z-]+):\s*([^;}]+)/g)) t[k] = v.trim();
  const ink = "#19181a";
  const check = (label, a, b) => {
    const r = ratio(a, b);
    if (!isFinite(r) || r < 4.5) {
      console.log(`FAIL ${id} ${label} (${a}) vs (${b}): ${isFinite(r) ? r.toFixed(2) : "NaN"} < 4.5`);
      fails++;
    } else console.log(`  ok ${id} ${label}: ${r.toFixed(2)}`);
  };
  for (const chip of ["yellow", "pink", "cyan", "green", "purple"]) {
    if (!t[chip]) {
      console.log(`FAIL ${id} missing token ${chip}`);
      fails++;
      continue;
    }
    check(`chip ${chip}`, t[chip], ink);
  }
  if (t["badge-peak"] && t.yellow) check("badge-peak", t.yellow, t["badge-peak"]);
  else {
    console.log(`FAIL ${id} missing badge-peak/yellow tokens`);
    fails++;
  }
  if (t["badge-off"] && t.green) check("badge-off", t.green, t["badge-off"]);
  else {
    console.log(`FAIL ${id} missing badge-off/green tokens`);
    fails++;
  }
}

if (fails) {
  console.log(`contrast check FAILED (${fails})`);
  process.exit(1);
}
console.log("contrast check PASSED for all light themes ✓");