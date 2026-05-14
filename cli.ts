/**
 * svg-to-excalidraw CLI
 *
 * Converts an SVG file (especially one exported from Excalidraw that has lost
 * its embedded scene data) back into an editable .excalidraw file.
 *
 * Usage:
 *   node cli.ts <input.svg> [output.excalidraw]
 *
 * If output path is omitted, writes to <input-basename>.excalidraw in the
 * current directory.
 */
import { parseHTML, DOMParser, NodeFilter } from "linkedom";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, basename, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ExcalidrawRectangle,
  ExcalidrawEllipse,
  ExcalidrawLine,
  ExcalidrawDraw,
  ExcalidrawText,
} from "./src/elements/ExcalidrawElement";

type ExcalidrawElement =
  | ExcalidrawRectangle
  | ExcalidrawEllipse
  | ExcalidrawLine
  | ExcalidrawDraw
  | ExcalidrawText;

// ── Bootstrap linkedom globals for the UMD bundle ───────────────────────
const { document: doc, window: win } = parseHTML("<!DOCTYPE html><html><body></body></html>");
(globalThis as any).window = win;
(globalThis as any).document = doc;
(globalThis as any).self = win;
(globalThis as any).DOMParser = DOMParser;
(globalThis as any).NodeFilter = NodeFilter;

// ── Load the svg-to-excalidraw UMD bundle ────────────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Compiled dist/cli.js: bundle.cjs is in the same directory
// Source cli.ts:         bundle.cjs is in dist/
const bundlePath = existsSync(resolve(__dir, "bundle.cjs"))
  ? resolve(__dir, "bundle.cjs")
  : resolve(__dir, "dist/bundle.cjs");
if (!existsSync(bundlePath)) {
  console.error(`Bundle not found. Run the build first: npm run build`);
  process.exit(1);
}

type ConvertFn = (svg: string) => {
  hasErrors: boolean;
  content: { elements: ExcalidrawElement[] } | null;
};

const lib = require(bundlePath) as { default?: { convert?: ConvertFn }; convert?: ConvertFn };
const convert: ConvertFn | undefined = lib.default?.convert ?? lib.convert;

// ── CLI argument handling ────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: node cli.ts <input.svg> [output.excalidraw]`);
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
// Convert
// ═══════════════════════════════════════════════════════════════════════════

let elements: ExcalidrawElement[] = [];
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
// Output
// ═══════════════════════════════════════════════════════════════════════════

const excalidrawData = {
  type: "excalidraw",
  version: 2,
  source: "svg-to-excalidraw",
  elements,
  appState: {
    viewBackgroundColor: "#ffffff",
    gridSize: null,
  },
  files: {},
};

writeFileSync(outputPath, JSON.stringify(excalidrawData, null, 2));
console.log(`Output: ${outputPath}`);
console.log(`Total:  ${elements.length} elements`);
