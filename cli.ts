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
// PHASE 1 — Shape conversion via svg-to-excalidraw library
// ═══════════════════════════════════════════════════════════════════════════

function stripUnsupportedElements(svg: string): string {
  const parser = new win.DOMParser();
  const doc = parser.parseFromString(svg, "image/svg+xml");
  const remove = ["use", "symbol", "defs", "text", "mask", "style", "metadata", "image"];
  for (const sel of remove) {
    for (const el of Array.from(doc.querySelectorAll(sel)) as any[]) {
      el.remove();
    }
  }
  for (const g of Array.from(doc.querySelectorAll("g[mask]")) as any[]) {
    g.remove();
  }
  return new win.XMLSerializer().serializeToString(doc);
}

let shapeElements: any[] = [];
if (convert) {
  try {
    const cleanedSvg = stripUnsupportedElements(svgString);
    const result = convert(cleanedSvg);
    if (!result.hasErrors && result.content) {
      shapeElements = result.content.elements ?? [];
    }
    console.log(`Shapes: ${shapeElements.length} elements from library`);
  } catch (err: any) {
    console.warn(`Shape conversion warning: ${err.message}`);
  }
} else {
  console.warn("Library convert() not available — shapes will be skipped");
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2 — Text extraction (the library doesn't handle <text> at all)
// ═══════════════════════════════════════════════════════════════════════════

function parseTransform(s: string): { tx: number; ty: number; angle: number } {
  let tx = 0, ty = 0, angle = 0;
  const tMatch = s.match(/translate\(\s*([-\d.e+]+)[\s,]+([-\d.e+]+)\s*\)/);
  if (tMatch) { tx = parseFloat(tMatch[1]); ty = parseFloat(tMatch[2]); }
  const rMatch = s.match(/rotate\(\s*([-\d.e+]+)/);
  if (rMatch) { angle = parseFloat(rMatch[1]); }
  return { tx, ty, angle };
}

function getAccumulatedOpacity(node: any): number {
  let opacity = 1;
  let el = node?.parentElement;
  while (el && el.tagName?.toLowerCase() !== "svg") {
    const so = el.getAttribute?.("stroke-opacity");
    const fo = el.getAttribute?.("fill-opacity");
    const o = el.getAttribute?.("opacity");
    // Use the most restrictive opacity from the ancestor chain
    if (so) opacity *= parseFloat(so);
    else if (fo) opacity *= parseFloat(fo);
    else if (o) opacity *= parseFloat(o);
    el = el.parentElement;
  }
  return opacity;
}

interface TextInfo {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fill: string;
  textAlign: "left" | "center" | "right";
  angle: number;
  opacity: number;
}

function extractTexts(svgStr: string): TextInfo[] {
  const parser = new win.DOMParser();
  const doc = parser.parseFromString(svgStr, "image/svg+xml");
  const results: TextInfo[] = [];

  for (const textEl of Array.from(doc.querySelectorAll("text")) as any[]) {
    const content = textEl.textContent?.trim();
    if (!content) continue;

    let totalTx = 0, totalTy = 0, totalAngle = 0;
    let node = textEl.parentElement;
    while (node && node.tagName?.toLowerCase() !== "svg") {
      const transform = node.getAttribute?.("transform");
      if (transform) {
        const { tx, ty, angle } = parseTransform(transform);
        totalTx += tx; totalTy += ty; totalAngle += angle;
      }
      node = node.parentElement;
    }

    const localX = parseFloat(textEl.getAttribute("x") ?? "0");
    const localY = parseFloat(textEl.getAttribute("y") ?? "0");
    const fontSize = parseFloat(textEl.getAttribute("font-size") ?? "16");
    const fill = textEl.getAttribute("fill") ?? "#1e1e1e";
    const anchor = textEl.getAttribute("text-anchor") ?? "start";
    const opacity = getAccumulatedOpacity(textEl);

    let textAlign: "left" | "center" | "right" = "left";
    if (anchor === "middle") textAlign = "center";
    else if (anchor === "end") textAlign = "right";

    results.push({
      text: content,
      x: totalTx + localX,
      // SVG text y = baseline; Excalidraw y = top-of-text
      y: totalTy + localY - fontSize * 0.8,
      fontSize,
      fill,
      textAlign,
      angle: (totalAngle * Math.PI) / 180,
      opacity: Math.round(opacity * 100),
    });
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3 — Post-processing & assembly
// ═══════════════════════════════════════════════════════════════════════════

let _seed = Date.now();
const nextSeed = () => _seed++;
const randomId = () =>
  Math.random().toString(36).substring(2, 12) +
  Math.random().toString(36).substring(2, 12);

function fixShapeElement(el: any): any | null {
  // Drop the full-canvas background rectangle
  if (el.type === "rectangle" && el.x === 0 && el.y === 0 && el.width > 3000 && el.height > 2000) {
    return null;
  }
  // Fix SVG "none" → Excalidraw "transparent"
  if (el.strokeColor === "none" || el.strokeColor === "#00000000") el.strokeColor = "transparent";
  if (el.backgroundColor === "none" || el.backgroundColor === "#00000000") el.backgroundColor = "transparent";
  return el;
}

function makeTextElement(info: TextInfo): any {
  const charWidth = info.fontSize * 0.6;
  const width = info.text.length * charWidth;
  const height = info.fontSize * 1.35;
  let x = info.x;
  if (info.textAlign === "center") x -= width / 2;
  else if (info.textAlign === "right") x -= width;

  return {
    id: randomId(),
    type: "text",
    x,
    y: info.y,
    width,
    height,
    angle: info.angle,
    strokeColor: info.fill,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: info.opacity,
    text: info.text,
    fontSize: info.fontSize,
    fontFamily: 1,
    textAlign: info.textAlign,
    verticalAlign: "top",
    containerId: null,
    originalText: info.text,
    autoResize: true,
    lineHeight: 1.25,
    seed: nextSeed(),
    version: 1,
    versionNonce: nextSeed(),
    isDeleted: false,
    groupIds: [],
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    frameId: null,
    index: null,
  };
}

// — Run text extraction
const allTexts = extractTexts(svgString);
const seen = new Set<string>();
const uniqueTexts = allTexts.filter((t) => {
  const key = `${t.text}|${t.x.toFixed(0)}|${t.y.toFixed(0)}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
console.log(`Texts:  ${uniqueTexts.length} unique (${allTexts.length} total, ${allTexts.length - uniqueTexts.length} deduped)`);

// — Assemble
const fixedShapes = shapeElements.map(fixShapeElement).filter(Boolean);
const textElements = uniqueTexts.map(makeTextElement);
const allElements = [...fixedShapes, ...textElements];

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
console.log(`Total:  ${allElements.length} elements (${fixedShapes.length} shapes + ${textElements.length} texts)`);
