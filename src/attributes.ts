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
  // Parse inline style attribute like "fill: red; stroke: blue"
  const match = style.match(new RegExp(`${attr}\\s*:\\s*([^;]+)`));
  if (!match) return null;

  // Strip !important and trim
  let value = match[1].trim();
  value = value.replace(/\s*!important\s*$/i, '');
  return value;
}

export function getNum(el: Element, attr: string, backup?: number): number {
  const numVal = parseFloat(get(el, attr));
  return isNaN(numVal) ? backup || 0 : numVal;
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
      exVals.strokeColor = "#00000000";
    } else {
      exVals.strokeColor = has(el, "stroke-opacity")
        ? hexWithAlpha(strokeColor, getNum(el, "stroke-opacity"))
        : strokeColor;
    }
  },

  "stroke-opacity": ({ el, exVals, cssParser }) => {
    const stroke = getWithCSS(el, "stroke", cssParser, "#000000");
    if (stroke === "none") {
      exVals.strokeColor = "#00000000";
    } else {
      exVals.strokeColor = hexWithAlpha(stroke, getNum(el, "stroke-opacity"));
    }
  },

  "stroke-width": ({ el, exVals, cssParser }) => {
    const widthStr = getWithCSS(el, "stroke-width", cssParser);
    // Remove 'px' suffix if present
    const widthNum = parseFloat(widthStr);
    exVals.strokeWidth = isNaN(widthNum) ? 1 : widthNum;
  },

  fill: ({ el, exVals, cssParser }) => {
    const fill = getWithCSS(el, "fill", cssParser);

    exVals.backgroundColor = fill === "none" ? "#00000000" : fill;
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

  // Also check CSS for fill and stroke if not found in attributes
  if (cssParser && !exVals.backgroundColor) {
    const fill = getWithCSS(el, "fill", cssParser);
    if (fill && fill !== "") {
      exVals.backgroundColor = fill === "none" ? "#00000000" : fill;
    }
  }

  if (cssParser && !exVals.strokeColor) {
    const stroke = getWithCSS(el, "stroke", cssParser);
    if (stroke && stroke !== "") {
      exVals.strokeColor = stroke;
    }
  }

  if (cssParser && !exVals.strokeWidth) {
    const strokeWidth = getWithCSS(el, "stroke-width", cssParser);
    if (strokeWidth && strokeWidth !== "") {
      const widthNum = parseFloat(strokeWidth);
      if (!isNaN(widthNum)) {
        exVals.strokeWidth = widthNum;
      }
    }
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
      .map((p) => p.split(",").map(parseFloat));
  }

  return points;
}
