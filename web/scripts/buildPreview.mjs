/**
 * Inlines the preview build into a single self-contained HTML file.
 *
 * The published preview has to be one file with no external requests, so the
 * built CSS and JS are inlined. The output deliberately omits <html>, <head>
 * and <body>, which the publishing host supplies.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIST = "dist-preview";
const OUT = process.argv[2] ?? "dist-preview/preview.html";

const assets = readdirSync(join(DIST, "assets"));
const jsFile = assets.find((f) => f.endsWith(".js"));
const cssFile = assets.find((f) => f.endsWith(".css"));
if (!jsFile || !cssFile) throw new Error("built assets not found — run the preview build first");

const js = readFileSync(join(DIST, "assets", jsFile), "utf8");
const css = readFileSync(join(DIST, "assets", cssFile), "utf8");

// Guard against shipping a bundle whose snapshot was tree-shaken away.
if (!js.includes("CUS-000001")) {
  throw new Error("snapshot data missing from the bundle — refusing to publish an empty preview");
}

// </script> inside the bundled JSON/strings would close the tag early.
const safeJs = js.replace(/<\/script>/gi, "<\\/script>");

const html = `<title>Small Lending OS</title>
<meta name="color-scheme" content="light">
<style>
${css}
/* The preview is a light-only product UI; keep it stable inside a dark host. */
:root { color-scheme: light; }
html, body { background: #f1f5f9; }
#root { min-height: 100vh; }
</style>
<div id="root"></div>
<script type="module">
${safeJs}
</script>
`;

writeFileSync(OUT, html);
console.log(`Wrote ${OUT} (${(html.length / 1024 / 1024).toFixed(2)} MB)`);
