// A server component may import only components from a "use client" file: a plain value (an array, a constant) comes
// across as a client reference, not the value. /leads read its filter names that way and ignored every filter in a link
// (FILTER_KEYS.map is not a function, React error #441 in the browser).
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP = path.join(__dirname, "..", "app");
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : [path.join(d, f)]));
const isClient = (file: string) => /^\s*["']use client["']/.test(readFileSync(file, "utf8"));
const resolve = (from: string, spec: string) => {
  const base = spec.startsWith("@/") ? path.join(__dirname, "..", spec.slice(2)) : path.resolve(path.dirname(from), spec);
  return [".tsx", ".ts"].map((x) => base + x).find((f) => { try { return statSync(f).isFile(); } catch { return false; } });
};

describe("server pages and client files", () => {
  it("no server file imports a non-component value from a \"use client\" file", () => {
    const bad: string[] = [];
    for (const file of walk(APP).filter((f) => /\.(tsx|ts)$/.test(f) && !isClient(f))) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/^import\s+(?!type\b)(?:(\w+)\s*,\s*)?\{([^}]+)\}\s+from\s+["']([^"']+)["']/gm)) {
        const target = m[3].startsWith(".") || m[3].startsWith("@/") ? resolve(file, m[3]) : undefined;
        if (!target || !isClient(target)) continue;
        // named imports from a client file: components (Capitalised) are fine, values (CONSTANTS, functions) are not
        for (const name of m[2].split(",").map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]).filter(Boolean)) {
          if (m[2].includes(`type ${name}`)) continue;
          if (!/^[A-Z][a-z]/.test(name)) bad.push(`${path.relative(APP, file)}: ${name} from ${m[3]}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
