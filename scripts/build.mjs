import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { minify } from "terser";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmpCss = join(root, "dist", ".tmp.css");
const dist = join(root, "dist");
const ogSource = join(root, "assets", "og-image.png");
// Names must survive minification: verify.cjs injects `window.__t = { … }` by
// string-replacing the trailing IIFE, so it needs these identifiers intact.
const EXPORT_NAMES = ["pad", "toMin", "utcDaySec", "isPeak", "nextTransition", "minuteMask", "hourFraction", "peakRuns", "fmtBoundary", "localMidnight", "countdownText", "priceModeText", "timelineHourLabel", "isNowHour", "taglineText"];

async function build() {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });

  execSync(`node_modules/.bin/tailwindcss -i src/style.css -o dist/.tmp.css --minify`, { cwd: root, stdio: "pipe" });
  const css = readFileSync(tmpCss, "utf8");

  const config = JSON.stringify(JSON.parse(readFileSync(join(root, "config.json"), "utf8")), null, 2);
  const app = (
    await minify(readFileSync(join(root, "src", "app.js"), "utf8"), {
      keep_fnames: true,
      mangle: { reserved: EXPORT_NAMES, keep_fnames: true },
      compress: { keep_fnames: true, inline: false, reduce_vars: false },
    })
  ).code;

  let html = readFileSync(join(root, "index.template.html"), "utf8");
  html = html.replace("/*__CSS__*/", () => css);
  html = html.replace("/*__CONFIG__*/", () => config);
  html = html.replace("/*__APP__*/", () => app);

  const cfg = JSON.parse(readFileSync(join(root, "config.json"), "utf8"));
  const siteUrl = (cfg.site?.url || "").replace(/\/+$/, "");
  if (!siteUrl) throw new Error("config.json missing site.url");
  html = html.split("__SITE_URL__").join(siteUrl);
  html = html.split("__OG_IMAGE_URL__").join(siteUrl + "/og-image.png");

  const leftover = html.match(/\/\*__(CSS|CONFIG|APP)__\*\//) || (html.includes("__SITE_URL__") || html.includes("__OG_IMAGE_URL__") ? html : null);
  if (leftover) {
    throw new Error(`placeholder not replaced: ${leftover}`);
  }

  writeFileSync(join(dist, "index.html"), html);

  copyFileSync(ogSource, join(dist, "og-image.png"));

  writeFileSync(
    join(dist, "robots.txt"),
    [
      "User-agent: *",
      "Allow: /",
      "",
    ].join("\n")
  );

  rmSync(tmpCss, { force: true });
  console.log("dist/index.html written", Buffer.byteLength(html), "bytes");
}

const watch = process.argv.includes("--watch");
await build();

if (watch) {
  const { watchFile } = await import("node:fs");
  const { debounce } = await import("node:util");
  const targets = ["src/style.css", "src/app.js", "config.json", "index.template.html"];
  for (const t of targets) {
    watchFile(join(root, t), { interval: 150 }, debounce(build, 100));
  }
  console.log("watching for changes…");
}