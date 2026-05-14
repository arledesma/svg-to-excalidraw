#!/usr/bin/env bun
/**
 * svg-to-excalidraw CLI
 *
 * Converts an SVG file (especially one exported from Excalidraw that has lost
 * its embedded scene data) back into an editable .excalidraw file.
 *
 * Usage:
 *   bun cli.ts <input.svg> [output.excalidraw]
 *
 * If output path is omitted, writes to <input-basename>.excalidraw in the
 * current directory.
 */
import { JSDOM } from "jsdom";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, basename, dirname, extname } from "path";

// ── Minimal DOMMatrix polyfill (jsdom lacks it) ─────────────────────────
class DOMMatrixPolyfill {
  m: Float32Array;
  constructor(init?: string | number[]) {
    this.m = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    if (typeof init === "string" && init.trim()) {
      this.parseCSS(init);
    }
  }
  private parseCSS(css: string) {
    const matMatch = css.match(
      /matrix\(\s*([-\d.e+]+)[\s,]+([-\d.e+]+)[\s,]+([-\d.e+]+)[\s,]+([-\d.e+]+)[\s,]+([-\d.e+]+)[\s,]+([-\d.e+]+)\s*\)/,
    );
    if (matMatch) {
      const [, a, b, c, d, e, f] = matMatch.map(Number);
      this.m[0] = a; this.m[1] = b; this.m[4] = c;
      this.m[5] = d; this.m[12] = e; this.m[13] = f;
      return;
    }
    const funcs = css.match(/(\w+)\(([^)]*)\)/g);
    if (!funcs) return;
    for (const func of funcs) {
      const parts = func.match(/(\w+)\(([^)]*)\)/);
      if (!parts) continue;
      const name = parts[1];
      const args = parts[2].split(/[\s,]+/).map(Number);
      if (name === "translate") {
        this.m[12] += args[0] || 0;
        this.m[13] += args[1] || 0;
      } else if (name === "scale") {
        const sx = args[0] || 1;
        const sy = args.length > 1 ? args[1] : sx;
        this.m[0] *= sx; this.m[5] *= sy;
      } else if (name === "rotate") {
        const rad = ((args[0] || 0) * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const a = this.m[0], b = this.m[1], c = this.m[4], d = this.m[5];
        this.m[0] = a * cos + c * sin;
        this.m[1] = b * cos + d * sin;
        this.m[4] = a * -sin + c * cos;
        this.m[5] = b * -sin + d * cos;
      }
    }
  }
  toFloat32Array(): Float32Array { return this.m; }
}

// ── Bootstrap jsdom with globals ─────────────────────────────────────────
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
  url: "https://localhost",
  pretendToBeVisual: true,
});
const win = dom.window as any;
(globalThis as any).window = win;
(globalThis as any).document = win.document;
(globalThis as any).self = win;
(globalThis as any).DOMParser = win.DOMParser;
(globalThis as any).NodeFilter = win.NodeFilter;
(globalThis as any).navigator = win.navigator;
(globalThis as any).DOMMatrix = DOMMatrixPolyfill;
(win as any).DOMMatrix = DOMMatrixPolyfill;

// ── Load the svg-to-excalidraw UMD bundle ────────────────────────────────
const bundlePath = resolve(import.meta.dir, "dist/bundle.js");
if (!existsSync(bundlePath)) {
  console.error(`Bundle not found at ${bundlePath}. Run the build first:`);
  console.error(`  NODE_OPTIONS=--openssl-legacy-provider bunx webpack --config webpack.config.js`);
  process.exit(1);
}
const bundleCode = readFileSync(bundlePath, "utf-8");
try { win.eval(bundleCode); } catch {}
const lib = win["svg-to-excalidraw"];
const convert: ((svg: string) => { hasErrors: boolean; content: any }) | undefined =
  lib?.default?.convert ?? lib?.convert;

// ── CLI argument handling ────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: bun cli.ts <input.svg> [output.excalidraw]`);
  console.log(`\nConverts SVG to editable Excalidraw format.`);
  console.log(`If output is omitted, writes <input>.excalidraw alongside the input.`);
  process.exit(0);
}

const inputPath = resolve(args[0]);
if (!existsSync(inputPath)) {
  console.error(`File not found: ${inputPath}`);
  process.exit(1);
}

const outputPath = args[1]
  ? resolve(args[1])
  : resolve(dirname(inputPath), basename(inputPath, extname(inputPath)) + ".excalidraw");

const svgString = readFileSync(inputPath, "utf-8");
console.log(`Input:  ${inputPath} (${(svgString.length / 1024).toFixed(0)} KB)`);

// ═══════════════════════════════════════════════════════════════════════════
// Convert — the library now handles shapes, text, and foreignObject natively.
// The use handler is graceful (skips instead of crashing on unsupported refs).
// ═══════════════════════════════════════════════════════════════════════════

let elements: any[] = [];
if (convert) {
  try {
    const result = convert(svgString);
    if (result.hasErrors) {
      console.warn("SVG parse errors detected, continuing with partial results");
    }
    elements = result.content?.elements ?? [];
    console.log(`Converted: ${elements.length} elements`);
  } catch (err: any) {
    console.error(`Conversion failed: ${err.message}`);
    process.exit(1);
  }
} else {
  console.error("Library convert() not available");
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════════════════
// Post-processing — normalize color values for Excalidraw compatibility
// ═══════════════════════════════════════════════════════════════════════════

function fixElement(el: any): any | null {
  // Drop full-canvas background rectangles (SVG viewBox fill)
  if (el.type === "rectangle" && el.x === 0 && el.y === 0 && el.width > 3000 && el.height > 2000) {
    return null;
  }
  // Normalize transparent values — Excalidraw understands "transparent"
  // but not SVG's "none" or hex "#00000000"
  if (el.strokeColor === "none" || el.strokeColor === "#00000000") el.strokeColor = "transparent";
  if (el.backgroundColor === "none" || el.backgroundColor === "#00000000") el.backgroundColor = "transparent";
  return el;
}

const allElements = elements.map(fixElement).filter(Boolean);

const excalidrawData = {
  type: "excalidraw",
  version: 2,
  source: "svg-to-excalidraw",
  elements: allElements,
  appState: {
    viewBackgroundColor: "#ffffff",
    gridSize: null,
  },
  files: {},
};

writeFileSync(outputPath, JSON.stringify(excalidrawData, null, 2));
console.log(`Output: ${outputPath}`);
console.log(`Total:  ${allElements.length} elements`);
