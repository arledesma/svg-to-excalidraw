import chroma from "chroma-js";
import { ExcalidrawElementBase } from "./elements/ExcalidrawElement";
import { CSSParser } from "./css-parser";

export function hexWithAlpha(color: string, alpha: number): string {
  return chroma(color).alpha(alpha).css();
}

export function has(el: Element, attr: string): boolean {
  return el.hasAttribute(attr);
}

export function get(el: Element, attr: string, backup?: string): string {
  // First check direct attributes
  const directAttr = el.getAttribute(attr);
  if (directAttr) return directAttr;

  // Then check inline style attribute
  const style = el.getAttribute("style");
  if (style) {
    const styleValue = parseStyleAttr(style, attr);
    if (styleValue) return styleValue;
  }

  return backup || "";
}

export function getWithCSS(
  el: Element,
  attr: string,
  cssParser: CSSParser | null,
  backup?: string,
): string {
  // First check direct attributes
  const directAttr = el.getAttribute(attr);
  if (directAttr) return directAttr;

  // Then check inline style attribute
  const style = el.getAttribute("style");
  if (style) {
    const styleValue = parseStyleAttr(style, attr);
    if (styleValue) return styleValue;
  }

  // Then check CSS rules
  if (cssParser) {
    const cssStyles = cssParser.getComputedStyles(el);
    const cssValue = cssStyles.get(attr);
    if (cssValue) return cssValue;
  }

  return backup || "";
}

function parseStyleAttr(style: string, attr: string): string | null {
  const match = new RegExp(String.raw`${attr}\s*:\s*([^;]+)`).exec(style);
  if (!match) return null;
  return match[1].trim().replace(/\s*!important\s*$/i, '');
}

// SVG absolute unit → px conversion factors (CSS spec: 1in = 96px)
const UNIT_TO_PX: Record<string, number> = {
  px: 1,
  pt: 96 / 72,     // 1pt = 1.333px
  pc: 96 / 6,      // 1pc = 16px
  in: 96,           // 1in = 96px
  cm: 96 / 2.54,   // 1cm ≈ 37.795px
  mm: 96 / 25.4,   // 1mm ≈ 3.780px
};

/**
 * Parse a CSS/SVG length value with unit to px.
 *
 * Absolute units (px, pt, pc, in, cm, mm) are converted precisely.
 * Relative units (em, rem) are resolved against a contextual base font size.
 * Percentage (%) and unresolvable units (ex, ch, vw, vh) return NaN so that
 * callers fall back to their backup value rather than silently misinterpreting
 * a relative number as px.
 * Unitless values are returned as-is (SVG user units = px).
 */
export function parseLengthToPx(value: string, baseFontSizePx?: number): number {
  const num = Number.parseFloat(value);
  if (Number.isNaN(num)) return Number.NaN;

  const unitMatch = /[a-z%]+$/i.exec(value);
  if (!unitMatch) return num; // unitless → px

  const unit = unitMatch[0].toLowerCase();

  // Absolute units
  if (unit in UNIT_TO_PX) return num * UNIT_TO_PX[unit];

  // Relative font units — resolve against context or 16px default
  if (unit === "em" || unit === "rem") return num * (baseFontSizePx ?? 16);

  // Percentage and viewport/font-metric units (ex, ch, vw, vh) can't be
  // resolved without layout context. Return NaN so getNum uses its backup.
  return Number.NaN;
}

/**
 * Walk up the DOM to find the nearest ancestor (or self) with an explicit
 * font-size attribute, and return it in px. Returns undefined if none found.
 */
function resolveBaseFontSize(el: Element): number | undefined {
  let node: Element | null = el.parentElement;
  while (node) {
    const fs = node.getAttribute("font-size");
    if (fs) {
      // Parse without context to avoid infinite recursion — ancestor font-size
      // should be absolute or unitless in well-formed SVG
      const px = parseLengthToPx(fs);
      if (!Number.isNaN(px)) return px;
    }
    node = node.parentElement;
  }
  return undefined;
}

export function getNum(el: Element, attr: string, backup?: number): number {
  const raw = get(el, attr);
  if (!raw) return backup || 0;
  const baseFontSize = resolveBaseFontSize(el);
  const numVal = parseLengthToPx(raw, baseFontSize);
  return Number.isNaN(numVal) ? backup || 0 : numVal;
}

const presAttrs = {
  stroke: "stroke",
  "stroke-opacity": "stroke-opacity",
  "stroke-width": "stroke-width",
  fill: "fill",
  "fill-opacity": "fill-opacity",
  opacity: "opacity",
} as const;

type ExPartialElement = Partial<ExcalidrawElementBase>;

type AttrHandlerArgs = {
  el: Element;
  exVals: ExPartialElement;
  cssParser: CSSParser | null;
};

type PresAttrHandlers = {
  [key in keyof typeof presAttrs]: (args: AttrHandlerArgs) => void;
};

const attrHandlers: PresAttrHandlers = {
  stroke: ({ el, exVals, cssParser }) => {
    const strokeColor = getWithCSS(el, "stroke", cssParser);

    // Convert "none" to transparent
    if (strokeColor === "none") {
      exVals.strokeColor = "transparent";
    } else {
      exVals.strokeColor = has(el, "stroke-opacity")
        ? hexWithAlpha(strokeColor, getNum(el, "stroke-opacity"))
        : strokeColor;
    }
  },

  "stroke-opacity": ({ el, exVals, cssParser }) => {
    const stroke = getWithCSS(el, "stroke", cssParser, "#000000");
    if (stroke === "none") {
      exVals.strokeColor = "transparent";
    } else {
      exVals.strokeColor = hexWithAlpha(stroke, getNum(el, "stroke-opacity"));
    }
  },

  "stroke-width": ({ el, exVals, cssParser }) => {
    const widthStr = getWithCSS(el, "stroke-width", cssParser);
    const widthNum = parseLengthToPx(widthStr);
    exVals.strokeWidth = Number.isNaN(widthNum) ? 1 : widthNum;
  },

  fill: ({ el, exVals, cssParser }) => {
    const fill = getWithCSS(el, "fill", cssParser);

    exVals.backgroundColor = fill === "none" ? "transparent" : fill;
  },

  "fill-opacity": ({ el, exVals, cssParser }) => {
    exVals.backgroundColor = hexWithAlpha(
      getWithCSS(el, "fill", cssParser, "#000000"),
      getNum(el, "fill-opacity"),
    );
  },

  opacity: ({ el, exVals, cssParser }) => {
    exVals.opacity = getNum(el, "opacity", 100);
  },
};

function applyCSSFallbacks(
  el: Element,
  exVals: ExPartialElement,
  cssParser: CSSParser,
): void {
  if (!exVals.backgroundColor) {
    const fill = getWithCSS(el, "fill", cssParser);
    if (fill) {
      exVals.backgroundColor = fill === "none" ? "transparent" : fill;
    }
  }

  if (!exVals.strokeColor) {
    const stroke = getWithCSS(el, "stroke", cssParser);
    if (stroke) {
      exVals.strokeColor = stroke;
    }
  }

  if (!exVals.strokeWidth) {
    const widthNum = parseLengthToPx(getWithCSS(el, "stroke-width", cssParser));
    if (!Number.isNaN(widthNum)) {
      exVals.strokeWidth = widthNum;
    }
  }
}

// Presentation Attributes for SVG Elements:
// https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/Presentation
export function presAttrsToElementValues(
  el: Element,
  cssParser: CSSParser | null = null,
): Partial<ExcalidrawElementBase> {
  const exVals: ExPartialElement = {};

  // Check element's direct attributes
  [...el.attributes].forEach((attr) => {
    const name = attr.name;
    if (Object.keys(attrHandlers).includes(name)) {
      attrHandlers[name as keyof PresAttrHandlers]({ el, exVals, cssParser });
    }
  });

  // Fill in any properties not set by direct attributes using CSS rules
  if (cssParser) {
    applyCSSFallbacks(el, exVals, cssParser);
  }

  return exVals;
}

type FilterAttrs = Partial<
  Pick<ExcalidrawElementBase, "x" | "y" | "width" | "height">
>;

export function filterAttrsToElementValues(el: Element): FilterAttrs {
  const filterVals: FilterAttrs = {};

  if (has(el, "x")) {
    filterVals.x = getNum(el, "x");
  }

  if (has(el, "y")) {
    filterVals.y = getNum(el, "y");
  }

  if (has(el, "width")) {
    filterVals.width = getNum(el, "width");
  }

  if (has(el, "height")) {
    filterVals.height = getNum(el, "height");
  }

  return filterVals;
}

export function pointsAttrToPoints(el: Element): number[][] {
  let points: number[][] = [];

  if (has(el, "points")) {
    points = get(el, "points")
      .split(" ")
      .map((p) => p.split(",").map((v) => parseLengthToPx(v)));
  }

  return points;
}
