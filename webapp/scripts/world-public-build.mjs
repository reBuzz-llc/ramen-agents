// Builds the public world (creatorCC queue 376) into one self-contained page, dist/world-public/index.html: the
// dashboard's world code bundled by esbuild with a few modules swapped for the read-only ones in world-public/, and the
// dashboard's Tailwind CSS, both inlined. scripts/world-public.ts serves it at GET /; nothing else is served.
//   node scripts/world-public-build.mjs
// Run again after a change to the world (app/world-view.tsx, app/world-draw.ts, lib/world.ts, ...); the server reads the
// file on each request, so no restart is needed.
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUB = path.join(ROOT, "world-public");
const OUT = path.join(ROOT, "dist", "world-public");

// what the dashboard's files import, swapped for the public bundle (the importer's directory is app/)
const SWAP = {
  "./hooks": path.join(PUB, "hooks.ts"),
  "./member-tabs": path.join(PUB, "member-tabs.tsx"),
  "./decision-actions": path.join(PUB, "stubs.tsx"),
  "./world-mode": path.join(PUB, "world-mode.ts"),
};
const NEXT = { "next/link": path.join(PUB, "stubs.tsx"), "next/navigation": path.join(PUB, "stubs.tsx") };

const swap = {
  name: "world-public-swap",
  setup(b) {
    b.onResolve({ filter: /^(\.\/(hooks|member-tabs|decision-actions|world-mode)|next\/(link|navigation))$/ }, (a) => {
      if (NEXT[a.path]) return { path: NEXT[a.path] };
      if (path.resolve(a.resolveDir) === path.join(ROOT, "app")) return { path: SWAP[a.path] };
      return undefined;
    });
  },
};

export async function buildWorld({ quiet = false } = {}) {
  const js = await build({
    entryPoints: [path.join(PUB, "entry.tsx")],
    bundle: true,
    minify: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: ["es2022"],
    jsx: "automatic",
    tsconfig: path.join(ROOT, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [swap],
    logLevel: quiet ? "error" : "warning",
  });
  const code = js.outputFiles[0].text.replace(/<\/(script)/gi, "<\\/$1");
  const cssIn = await readFile(path.join(ROOT, "app", "globals.css"), "utf8");
  const css = (await postcss([tailwind({ base: ROOT, optimize: { minify: true } })]).process(cssIn, { from: path.join(ROOT, "app", "globals.css") })).css;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow"><title>The family, live</title>
<style>:root{--font-screen:ui-monospace,Menlo,monospace}${css}</style></head>
<body class="min-h-full font-sans bg-bg text-ink"><div id="root"></div><script>${code}</script></body></html>
`;
  await mkdir(OUT, { recursive: true });
  await writeFile(path.join(OUT, "index.html"), html);
  if (!quiet) console.log(`dist/world-public/index.html: ${(html.length / 1024).toFixed(0)} KB (js ${(code.length / 1024).toFixed(0)} KB, css ${(css.length / 1024).toFixed(0)} KB)`);
  return html.length;
}

if (import.meta.url === `file://${process.argv[1]}`) await buildWorld();
