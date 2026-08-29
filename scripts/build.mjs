import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { minify } from "terser";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmpCss = join(root, "dist", ".tmp.css");
const dist = join(root, "dist");
const ogSource = join(root, "assets", "og-image.png");
const manifestSource = join(root, "assets", "site.webmanifest");
const iconFiles = ["favicon.ico", "favicon-96x96.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png"];
// Names must survive minification: verify.cjs injects `window.__t = { … }` by
// string-replacing the trailing IIFE, so it needs these identifiers intact.
const EXPORT_NAMES = ["pad", "toMin", "utcDaySec", "isPeak", "nextTransition", "minuteMask", "hourFraction", "peakRuns", "fmtBoundary", "localMidnight", "countdownText", "priceModeText", "timelineHourLabel", "isNowHour", "taglineText", "isWeekend", "badgeMsgText"];

async function build() {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });

  execSync(`node_modules/.bin/tailwindcss -i src/style.css -o dist/.tmp.css --minify`, { cwd: root, stdio: "pipe" });
  const css = readFileSync(tmpCss, "utf8");

  const config = JSON.stringify(JSON.parse(readFileSync(join(root, "config.json"), "utf8")), null, 2);
  const themes = readFileSync(join(root, "src", "themes.js"), "utf8");
  // Themes are prepended to every page bundle so the theme list has one source of truth.
  const bundle = async (file) =>
    (
      await minify(themes + readFileSync(join(root, "src", file), "utf8"), {
        keep_fnames: true,
        mangle: { reserved: EXPORT_NAMES, keep_fnames: true },
        compress: { keep_fnames: true, inline: false, reduce_vars: false },
      })
    ).code;
  const app = await bundle("app.js");
  // Sub-pages are static content; they only need the shared theme picker.
  const subApp = await bundle("subpage.js");

  let html = readFileSync(join(root, "index.template.html"), "utf8");
  html = html.replace("/*__CSS__*/", () => css);
  html = html.replace("/*__CONFIG__*/", () => config);
  html = html.replace("/*__APP__*/", () => app);

  const cfg = JSON.parse(readFileSync(join(root, "config.json"), "utf8"));
  const siteUrl = (cfg.site?.url || "").replace(/\/+$/, "");
  if (!siteUrl) throw new Error("config.json missing site.url");
  const siteName = cfg.site?.name || "";
  if (!siteName) throw new Error("config.json missing site.name");
  html = html.split("__SITE_URL__").join(siteUrl);
  html = html.split("__OG_IMAGE_URL__").join(siteUrl + "/og-image.png");

  const leftover = html.match(/\/\*__(CSS|CONFIG|APP)__\*\//) || (html.includes("__SITE_URL__") || html.includes("__OG_IMAGE_URL__") ? html : null);
  if (leftover) {
    throw new Error(`placeholder not replaced: ${leftover}`);
  }

  writeFileSync(join(dist, "index.html"), html);

  for (const slug of ["agentrouter", "omp"]) {
    let page = readFileSync(join(root, `${slug}.template.html`), "utf8");
    page = page.replace("/*__CSS__*/", () => css);
    page = page.replace("/*__SUB_APP__*/", () => subApp);
    page = page.split("__SITE_URL__").join(siteUrl);
    page = page.split("__OG_IMAGE_URL__").join(siteUrl + "/og-image.png");
    if (page.match(/\/\*__(CSS|SUB_APP)__\*\//) || page.includes("__SITE_URL__") || page.includes("__OG_IMAGE_URL__")) {
      throw new Error(`${slug} placeholder not replaced`);
    }
    mkdirSync(join(dist, slug), { recursive: true });
    writeFileSync(join(dist, slug, "index.html"), page);
  }

  copyFileSync(ogSource, join(dist, "og-image.png"));

  for (const f of iconFiles) {
    copyFileSync(join(root, "assets", f), join(dist, f));
  }

  let manifest = readFileSync(manifestSource, "utf8");
  manifest = manifest.split("__SITE_NAME__").join(siteName);
  manifest = manifest.split("__SITE_URL__").join(siteUrl);
  if (manifest.includes("__SITE_NAME__") || manifest.includes("__SITE_URL__")) {
    throw new Error("manifest placeholder not replaced");
  }
  writeFileSync(join(dist, "site.webmanifest"), manifest);

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
  const targets = ["src/style.css", "src/app.js", "src/themes.js", "src/subpage.js", "config.json", "index.template.html", "agentrouter.template.html", "omp.template.html", "assets/site.webmanifest"];
  for (const t of targets) {
    watchFile(join(root, t), { interval: 150 }, debounce(build, 100));
  }
  console.log("watching for changes…");
}