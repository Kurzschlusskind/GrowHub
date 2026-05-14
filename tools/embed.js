import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const htmlPath = resolve("dist/index.html");
const outPath = resolve("dist/GeneratedWebUi.h");
const distDir = dirname(htmlPath);

let html = readFileSync(htmlPath, "utf8");

html = html.replace(
  /<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/,
  (_, href) => {
    const css = readFileSync(resolve(distDir, href.replace(/^\//, "")), "utf8");
    return `<style>${css}</style>`;
  },
);

html = html.replace(
  /<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/,
  (_, src) => {
    const js = readFileSync(resolve(distDir, src.replace(/^\//, "")), "utf8");
    return `<script>${js}</script>`;
  },
);

writeFileSync(
  outPath,
  `#pragma once\n\nconstexpr const char* kIndexHtml = R"GROWHUB_HTML(${html})GROWHUB_HTML";\n`,
);

console.log(`Wrote ${outPath}`);
