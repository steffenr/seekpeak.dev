import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmpCss = join(root, "dist", ".tmp.css");
const dist = join(root, "dist");

function build() {
  mkdirSync(dist, { recursive: true });

  execSync(`node_modules/.bin/tailwindcss -i src/style.css -o dist/.tmp.css --minify`, { cwd: root, stdio: "pipe" });
  const css = readFileSync(tmpCss, "utf8");

  const config = JSON.stringify(JSON.parse(readFileSync(join(root, "config.json"), "utf8")), null, 2);
  const app = readFileSync(join(root, "src", "app.js"), "utf8");

  let html = readFileSync(join(root, "index.template.html"), "utf8");
  html = html.replace("/*__CSS__*/", () => css);
  html = html.replace("/*__CONFIG__*/", () => config);
  html = html.replace("/*__APP__*/", () => app);

  const leftover = html.match(/\/\*__(CSS|CONFIG|APP)__\*\//);
  if (leftover) {
    throw new Error(`placeholder not replaced: ${leftover[0]}`);
  }

  writeFileSync(join(dist, "index.html"), html);
  rmSync(tmpCss, { force: true });
  console.log("dist/index.html written", Buffer.byteLength(html), "bytes");
}

const watch = process.argv.includes("--watch");
build();

if (watch) {
  const { watchFile } = await import("node:fs");
  const { debounce } = await import("node:util");
  const targets = ["src/style.css", "src/app.js", "config.json", "index.template.html"];
  for (const t of targets) {
    watchFile(join(root, t), { interval: 150 }, debounce(build, 100));
  }
  console.log("watching for changes…");
}
