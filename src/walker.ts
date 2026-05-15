import { mat4 } from "gl-matrix";
import { dimensionsFromPoints, randomId, getWindingOrder } from "./utils";
import ExcalidrawScene from "./elements/ExcalidrawScene";
import Group, { getGroupAttrs } from "./elements/Group";
import {
  ExcalidrawElementBase,
  ExcalidrawRectangle,
  ExcalidrawEllipse,
  ExcalidrawLine,
  ExcalidrawDraw,
  ExcalidrawText,
  ExcalidrawImage,
  createExRect,
  createExEllipse,
  createExLine,
  createExDraw,
  createExText,
  createExImage,
  Point,
} from "./elements/ExcalidrawElement";
import {
  presAttrsToElementValues,
  filterAttrsToElementValues,
  pointsAttrToPoints,
  has,
  get,
  getNum,
} from "./attributes";
import { getTransformMatrix, transformPoints } from "./transform";
import { pointsOnPath } from "points-on-path";
import { getCSSParser, type CSSParser } from "./css-parser";

const SUPPORTED_TAGS = new Set([
  "svg",
  "path",
  "g",
  "use",
  "circle",
  "ellipse",
  "rect",
  "polyline",
  "polygon",
  "text",
  "foreignObject",
  "switch",
  "image",
]);

const nodeValidator = (node: Element): number => {
  if (SUPPORTED_TAGS.has(node.tagName)) {
    return NodeFilter.FILTER_ACCEPT;
  }

  return NodeFilter.FILTER_REJECT;
};

export function createTreeWalker(dom: Node): TreeWalker {
  return document.createTreeWalker(dom, NodeFilter.SHOW_ALL, {
    acceptNode: nodeValidator,
  });
}

/** Advance to the next sibling, skipping descendants of the current node.
 *  Polyfills TreeWalker.nextSibling() for DOM implementations (e.g.
 *  linkedom) that only provide nextNode(). */
function nextSiblingOf(tw: TreeWalker): Node | null {
  if (typeof tw.nextSibling === "function") {
    return tw.nextSibling();
  }
  const current = tw.currentNode;
  let next = tw.nextNode();
  while (next && current.contains(next)) {
    next = tw.nextNode();
  }
  return next;
}

type WalkerArgs = {
  root: Document;
  tw: TreeWalker;
  scene: ExcalidrawScene;
  groups: Group[];
  cssParser: CSSParser | null;
};

const presAttrs = (
  el: Element,
  groups: Group[],
  cssParser: CSSParser | null,
): Partial<ExcalidrawElementBase> => {
  return {
    ...getGroupAttrs(groups),
    ...presAttrsToElementValues(el, cssParser),
    ...filterAttrsToElementValues(el),
  };
};

const skippedUseAttrs = new Set(["id"]);
const alwaysPassedUseAttrs = new Set([
  "x",
  "y",
  "width",
  "height",
  "href",
  "xlink:href",
]);

/*
  "Most attributes on use do not override those already on the element
  referenced by use. (This differs from how CSS style attributes override
  those set 'earlier' in the cascade). Only the attributes x, y, width,
  height and href on the use element will override those set on the
  referenced element. However, any other attributes not set on the referenced
  element will be applied to the use element."

  Situation 1: Attr is set on defEl, NOT on useEl
    - result: use defEl attr
  Situation 2: Attr is on useEl, NOT on defEl
    - result: use the useEl attr
  Situation 3: Attr is on both useEl and defEl
    - result: use the defEl attr (Unless x, y, width, height, href, xlink:href)
*/
const getDefElWithCorrectAttrs = (defEl: Element, useEl: Element): Element => {
  const finalEl = [...useEl.attributes].reduce((el, attr) => {
    if (skippedUseAttrs.has(attr.value)) {
      return el;
    }

    // Does defEl have the attr? If so, use it, else use the useEl attr
    if (
      !defEl.hasAttribute(attr.name) ||
      alwaysPassedUseAttrs.has(attr.name)
    ) {
      el.setAttribute(attr.name, useEl.getAttribute(attr.name) || "");
    }
    return el;
  }, defEl.cloneNode() as Element);

  return finalEl;
};

/** Extract position, font size, and color from a foreignObject element.
 *  draw.io uses CSS padding-top/margin-left on inner divs for positioning
 *  and nested divs with font-size for styling. */
function parseForeignObjectLayout(el: Element): {
  x: number; y: number; fontSize: number; color: string;
} {
  let x = getNum(el, "x", 0);
  let y = getNum(el, "y", 0);
  let fontSize = 16;
  let color = "#000000";

  const outerDiv = el.querySelector?.("div");
  if (!outerDiv) return { x, y, fontSize, color };

  const outerStyle = outerDiv.getAttribute("style") || "";
  const ptMatch = /padding-top:\s*([\d.]+)px/.exec(outerStyle);
  const mlMatch = /margin-left:\s*([\d.]+)px/.exec(outerStyle);
  if (ptMatch) y = Number.parseFloat(ptMatch[1]);
  if (mlMatch) x = Number.parseFloat(mlMatch[1]);

  // Find the innermost div with a real font-size (not font-size: 0)
  for (const div of Array.from(el.querySelectorAll?.("div") ?? []) as Element[]) {
    const style = div.getAttribute("style") || "";
    const fsMatch = /font-size:\s*([\d.]+)px/.exec(style);
    if (fsMatch && fsMatch[1] !== "0") {
      fontSize = Number.parseFloat(fsMatch[1]);
      const colorMatch = /(?:^|;\s*)color:\s*(#[0-9a-fA-F]{3,8}|[a-z]+)/.exec(style);
      if (colorMatch) color = colorMatch[1];
      break;
    }
  }

  return { x, y, fontSize, color };
}

/** Get inner SVG dimensions from its width/height or viewBox. */
function getSvgDimensions(doc: Document): { w: number; h: number } {
  const svg = doc.querySelector("svg");
  const w = Number.parseFloat(svg?.getAttribute("width") || "0") ||
            Number.parseFloat(svg?.getAttribute("viewBox")?.split(/\s+/)[2] || "0");
  const h = Number.parseFloat(svg?.getAttribute("height") || "0") ||
            Number.parseFloat(svg?.getAttribute("viewBox")?.split(/\s+/)[3] || "0");
  return { w, h };
}

/** Compute offset position from an element's x/y + accumulated group transforms. */
function computeOffset(el: Element, groups: Group[]): { ox: number; oy: number } {
  const mat = getTransformMatrix(el, groups);
  const x = getNum(el, "x", 0);
  const y = getNum(el, "y", 0);
  const m = mat4.fromValues(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, 0, 1);
  const result = mat4.multiply(mat4.create(), mat, m);
  return { ox: result[12], oy: result[13] };
}

/** Embed an image as an Excalidraw image element with file data. */
function embedAsImage(
  el: Element, href: string, w: number, h: number,
  scene: ExcalidrawScene, groups: Group[],
): void {
  if (w === 0 || h === 0) return;
  const { ox, oy } = computeOffset(el, groups);
  const fileId = randomId();
  const mimeMatch = /^data:(image\/[^;]+);/.exec(href);
  scene.files[fileId] = {
    mimeType: mimeMatch ? mimeMatch[1] : "image/png",
    id: fileId,
    dataURL: href,
    created: Date.now(),
  };
  scene.elements.push({
    ...createExImage(fileId),
    x: ox, y: oy, width: w, height: h,
    groupIds: groups.map((g) => g.id),
  });
}

/** Recursively convert a large embedded SVG and merge results into the scene. */
function convertEmbeddedSvg(
  el: Element, innerDoc: Document, imgW: number, imgH: number,
  scene: ExcalidrawScene, groups: Group[],
): void {
  const innerCss = getCSSParser(innerDoc);
  const innerScene = new ExcalidrawScene();
  const innerTw = createTreeWalker(innerDoc);

  walk(
    { tw: innerTw, scene: innerScene, groups: [], root: innerDoc, cssParser: innerCss },
    innerTw.nextNode(),
  );

  if (innerScene.elements.length === 0) return;

  const { ox, oy } = computeOffset(el, groups);
  const { w: innerW, h: innerH } = getSvgDimensions(innerDoc);
  const sx = (imgW && innerW) ? imgW / innerW : 1;
  const sy = (imgH && innerH) ? imgH / innerH : 1;

  for (const elem of innerScene.elements) {
    elem.x = elem.x * sx + ox;
    elem.y = elem.y * sy + oy;
    elem.width *= sx;
    elem.height *= sy;
    scene.elements.push(elem);
  }
  Object.assign(scene.files, innerScene.files);
}

/** Handle data: URI images — recursively convert large SVGs, embed the rest. */
function handleDataImage(
  el: Element, href: string, scene: ExcalidrawScene, groups: Group[],
): void {
  let w = getNum(el, "width", 0);
  let h = getNum(el, "height", 0);

  if (href.startsWith("data:image/svg+xml;base64,")) {
    const base64 = href.slice("data:image/svg+xml;base64,".length);
    let innerSvg: string;
    try { innerSvg = atob(base64); } catch { return; }

    const innerDoc = new DOMParser().parseFromString(innerSvg, "image/svg+xml");
    const dims = getSvgDimensions(innerDoc);
    if (!w) w = dims.w;
    if (!h) h = dims.h;

    // Large SVGs (full diagrams) are recursively converted to editable elements.
    // Small SVGs (icons) are embedded as images to preserve visual fidelity.
    if (dims.w >= 200 && dims.h >= 200) {
      convertEmbeddedSvg(el, innerDoc, w, h, scene, groups);
      return;
    }
  }

  // Raster image (PNG, JPEG) or small SVG icon — embed as Excalidraw image
  embedAsImage(el, href, w, h, scene, groups);
}

const walkers = {
  svg: (args: WalkerArgs) => {
    walk(args, args.tw.nextNode());
  },

  g: (args: WalkerArgs) => {
    const nextArgs = {
      ...args,
      tw: createTreeWalker(args.tw.currentNode),
      groups: [...args.groups, new Group(args.tw.currentNode as Element)],
    };

    walk(nextArgs, nextArgs.tw.nextNode());

    walk(args, nextSiblingOf(args.tw));
  },

  use: (args: WalkerArgs) => {
    const { root, tw, scene } = args;
    const useEl = tw.currentNode as Element;

    const id = useEl.getAttribute("href") || useEl.getAttribute("xlink:href");

    if (!id) {
      // Skip use elements without a reference instead of crashing
      walk(args, args.tw.nextNode());
      return;
    }

    const defEl = root.querySelector(id);

    if (!defEl) {
      // Referenced element not found (may be in an external file) — skip
      walk(args, args.tw.nextNode());
      return;
    }

    const tempScene = new ExcalidrawScene();

    // For leaf elements (rect, circle, etc.), merge use/def attributes.
    // For containers (symbol, g), walk the original def's children directly
    // since cloneNode() is shallow and would lose children.
    const walkTarget = defEl.children.length > 0 ? defEl : getDefElWithCorrectAttrs(defEl, useEl);
    const subTw = createTreeWalker(walkTarget);

    walk(
      { ...args, scene: tempScene, tw: subTw },
      subTw.nextNode() ?? walkTarget,
    );

    if (tempScene.elements.length > 0) {
      scene.elements.push(...tempScene.elements);
      Object.assign(scene.files, tempScene.files);
    }

    walk(args, args.tw.nextNode());
  },

  circle: (args: WalkerArgs): void => {
    const { tw, scene, groups, cssParser } = args;
    const el = tw.currentNode as Element;

    const r = getNum(el, "r", 0);
    const d = r * 2;
    const x = getNum(el, "x", 0) + getNum(el, "cx", 0) - r;
    const y = getNum(el, "y", 0) + getNum(el, "cy", 0) - r;

    const mat = getTransformMatrix(el, groups);

    // @ts-ignore
    const m = mat4.fromValues(d, 0, 0, 0, 0, d, 0, 0, 0, 0, 1, 0, x, y, 0, 1);

    const result = mat4.multiply(mat4.create(), mat, m);

    const circle: ExcalidrawEllipse = {
      ...createExEllipse(),
      ...presAttrs(el, groups, cssParser),
      x: result[12],
      y: result[13],
      width: result[0],
      height: result[5],
      groupIds: groups.map((g) => g.id),
    };

    scene.elements.push(circle);

    walk(args, tw.nextNode());
  },

  ellipse: (args: WalkerArgs): void => {
    const { tw, scene, groups, cssParser } = args;
    const el = tw.currentNode as Element;

    const rx = getNum(el, "rx", 0);
    const ry = getNum(el, "ry", 0);
    const cx = getNum(el, "cx", 0);
    const cy = getNum(el, "cy", 0);
    const x = getNum(el, "x", 0) + cx - rx;
    const y = getNum(el, "y", 0) + cy - ry;
    const w = rx * 2;
    const h = ry * 2;

    const mat = getTransformMatrix(el, groups);

    const m = mat4.fromValues(w, 0, 0, 0, 0, h, 0, 0, 0, 0, 1, 0, x, y, 0, 1);

    const result = mat4.multiply(mat4.create(), mat, m);

    const ellipse: ExcalidrawEllipse = {
      ...createExEllipse(),
      ...presAttrs(el, groups, cssParser),
      x: result[12],
      y: result[13],
      width: result[0],
      height: result[5],
      groupIds: groups.map((g) => g.id),
    };

    scene.elements.push(ellipse);

    walk(args, tw.nextNode());
  },

  line: (args: WalkerArgs) => {
    // unimplemented
    walk(args, args.tw.nextNode());
  },

  polygon: (args: WalkerArgs) => {
    const { tw, scene, groups, cssParser } = args;
    const el = tw.currentNode as Element;

    const points = pointsAttrToPoints(el);

    const mat = getTransformMatrix(el, groups);

    const transformedPoints = transformPoints(points, mat);

    // The first point needs to be 0, 0, and all following points
    // are relative to the first point.
    const x = transformedPoints[0][0];
    const y = transformedPoints[0][1];

    const relativePoints: Point[] = transformedPoints.map(
      ([_x, _y]): Point => [_x - x, _y - y],
    );

    const [width, height] = dimensionsFromPoints(relativePoints);

    const line: ExcalidrawLine = {
      ...createExLine(),
      ...presAttrs(el, groups, cssParser),
      points: relativePoints.concat([[0, 0]] as Point[]),
      x,
      y,
      width,
      height,
    };

    scene.elements.push(line);

    walk(args, args.tw.nextNode());
  },

  polyline: (args: WalkerArgs) => {
    const { tw, scene, groups, cssParser } = args;
    const el = tw.currentNode as Element;

    const mat = getTransformMatrix(el, groups);

    const points = pointsAttrToPoints(el);
    const transformedPoints = transformPoints(points, mat);

    // The first point needs to be 0, 0, and all following points
    // are relative to the first point.
    const x = transformedPoints[0][0];
    const y = transformedPoints[0][1];

    const relativePoints: Point[] = transformedPoints.map(
      ([_x, _y]): Point => [_x - x, _y - y],
    );

    const [width, height] = dimensionsFromPoints(relativePoints);

    const hasFill = has(el, "fill");
    const fill = get(el, "fill");

    const shouldFill = !hasFill || (hasFill && fill !== "none");

    const line: ExcalidrawLine = {
      ...createExLine(),
      ...presAttrs(el, groups, cssParser),
      points: relativePoints.concat(shouldFill ? ([[0, 0]] as Point[]) : []),
      x,
      y,
      width,
      height,
    };

    scene.elements.push(line);

    walk(args, args.tw.nextNode());
  },

  rect: (args: WalkerArgs) => {
    const { tw, scene, groups, cssParser } = args;
    const el = tw.currentNode as Element;

    const x = getNum(el, "x", 0);
    const y = getNum(el, "y", 0);
    const w = getNum(el, "width", 0);
    const h = getNum(el, "height", 0);

    // Skip full-canvas background rects (SVG viewBox fill at root level)
    if (x === 0 && y === 0 && groups.length === 0 && w > 3000 && h > 2000) {
      walk(args, tw.nextNode());
      return;
    }

    const mat = getTransformMatrix(el, groups);

    // @ts-ignore
    const m = mat4.fromValues(w, 0, 0, 0, 0, h, 0, 0, 0, 0, 1, 0, x, y, 0, 1);

    const result = mat4.multiply(mat4.create(), mat, m);

    /*
    NOTE: Currently there doesn't seem to be a way to specify the border
          radius of a rect within Excalidraw. This means that attributes
          rx and ry can't be used.
    */
    const isRound = el.hasAttribute("rx") || el.hasAttribute("ry");

    const rect: ExcalidrawRectangle = {
      ...createExRect(),
      ...presAttrs(el, groups, cssParser),
      x: result[12],
      y: result[13],
      width: result[0],
      height: result[5],
      strokeSharpness: isRound ? "round" : "sharp",
    };

    scene.elements.push(rect);

    walk(args, args.tw.nextNode());
  },

  path: (args: WalkerArgs) => {
    const { tw, scene, groups, cssParser } = args;
    const el = tw.currentNode as Element;

    const mat = getTransformMatrix(el, groups);

    const points = pointsOnPath(get(el, "d"));

    const fillColor = get(el, "fill", "none");
    const fillRule = get(el, "fill-rule", "nonzero");

    let elements: ExcalidrawDraw[] = [];
    let localGroup = randomId();

    switch (fillRule) {
      case "nonzero": {
        let initialWindingOrder = "clockwise";

        elements = points.map((pointArr, idx): ExcalidrawDraw => {
          const tPoints: Point[] = transformPoints(pointArr, mat4.clone(mat));
          const x = tPoints[0][0];
          const y = tPoints[0][1];

          const [width, height] = dimensionsFromPoints(tPoints);

          const relativePoints = tPoints.map(
            ([_x, _y]): Point => [_x - x, _y - y],
          );

          const windingOrder = getWindingOrder(relativePoints);
          if (idx === 0) {
            initialWindingOrder = windingOrder;
            localGroup = randomId();
          }

          let backgroundColor = fillColor;
          if (initialWindingOrder !== windingOrder) {
            backgroundColor = "#FFFFFF";
          }

          // Get presentation attributes first
          const attrs = presAttrs(el, groups, cssParser);

          // Only set transparent stroke if this is a filled path (has fill and no visible stroke)
          const hasFill = fillColor && fillColor !== "none";
          const hasVisibleStroke = has(el, "stroke") && get(el, "stroke") !== "none" ||
                                   (attrs.strokeColor && attrs.strokeColor !== "transparent");

          // Default stroke color for paths without fill
          const defaultStroke = hasFill ? {} : { strokeColor: attrs.strokeColor || "#333333", strokeWidth: attrs.strokeWidth || 1 };

          return {
            ...createExDraw(),
            // Only make stroke transparent if this is clearly a filled path with no stroke
            ...(hasFill && !hasVisibleStroke ? { strokeWidth: 0, strokeColor: "transparent" } : defaultStroke),
            ...attrs,
            points: relativePoints,
            backgroundColor: backgroundColor === "none" ? "transparent" : backgroundColor,
            width,
            height,
            x: x + getNum(el, "x", 0),
            y: y + getNum(el, "y", 0),
            groupIds: [localGroup],
          };
        });
        break;
      }
      case "evenodd":
        elements = points.map((pointArr, idx): ExcalidrawDraw => {
          const tPoints: Point[] = transformPoints(pointArr, mat4.clone(mat));
          const x = tPoints[0][0];
          const y = tPoints[0][1];

          const [width, height] = dimensionsFromPoints(tPoints);

          const relativePoints = tPoints.map(
            ([_x, _y]): Point => [_x - x, _y - y],
          );

          if (idx === 0) {
            localGroup = randomId();
          }

          return {
            ...createExDraw(),
            ...presAttrs(el, groups, cssParser),
            points: relativePoints,
            width,
            height,
            x: x + getNum(el, "x", 0),
            y: y + getNum(el, "y", 0),
          };
        });
        break;
      default:
    }

    scene.elements = scene.elements.concat(elements);

    walk(args, tw.nextNode());
  },

  text: (args: WalkerArgs) => {
    const { tw, scene, groups, cssParser } = args;
    const el = tw.currentNode as Element;

    // Get the text content
    let textContent = el.textContent || "";
    textContent = textContent.trim();

    if (!textContent) {
      walk(args, tw.nextNode());
      return;
    }

    // Get position and size
    const rawX = getNum(el, "x", 0);
    const rawY = getNum(el, "y", 0);
    const fontSize = getNum(el, "font-size", 16);
    const anchor = get(el, "text-anchor", "start");

    // Estimate width and height based on text length and font size
    const avgCharWidth = fontSize * 0.6;
    const width = textContent.length * avgCharWidth;
    const height = fontSize * 1.2;

    // SVG text-anchor defines what the x coordinate refers to:
    //   start  → x is the left edge
    //   middle → x is the center
    //   end    → x is the right edge
    // Excalidraw positions text at its top-left corner, so adjust.
    let x = rawX;
    if (anchor === "middle") x -= width / 2;
    else if (anchor === "end") x -= width;

    const mat = getTransformMatrix(el, groups);

    const m = mat4.fromValues(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, rawY, 0, 1);
    const result = mat4.multiply(mat4.create(), mat, m);

    const text: ExcalidrawText = {
      ...createExText(),
      ...presAttrs(el, groups, cssParser),
      text: textContent,
      fontSize,
      x: result[12],
      y: result[13] - fontSize, // Adjust for SVG baseline → top-left
      width,
      height,
      groupIds: groups.map((g) => g.id),
    };

    scene.elements.push(text);

    walk(args, tw.nextNode());
  },

  foreignObject: (args: WalkerArgs) => {
    const { tw, scene, groups } = args;
    const el = tw.currentNode as Element;

    const textContent = (el.textContent || "").trim();
    if (!textContent) {
      walk(args, tw.nextNode());
      return;
    }

    const { x, y, fontSize, color } = parseForeignObjectLayout(el);

    const width = textContent.length * fontSize * 0.6;
    const height = fontSize * 1.4;

    const mat = getTransformMatrix(el, groups);
    const m = mat4.fromValues(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, 0, 1);
    const result = mat4.multiply(mat4.create(), mat, m);

    const text: ExcalidrawText = {
      ...createExText(),
      text: textContent,
      fontSize,
      x: result[12],
      y: result[13],
      width,
      height,
      groupIds: groups.map((g) => g.id),
      strokeColor: color,
      backgroundColor: "transparent",
    };

    scene.elements.push(text);

    walk(args, tw.nextNode());
  },

  // SVG <switch> renders the first supported child. Walk into children
  // so that <foreignObject> elements inside are processed.
  switch: (args: WalkerArgs) => {
    const nextArgs = {
      ...args,
      tw: createTreeWalker(args.tw.currentNode),
    };
    walk(nextArgs, nextArgs.tw.nextNode());
    walk(args, nextSiblingOf(args.tw));
  },

  image: (args: WalkerArgs) => {
    const { tw, scene, groups } = args;
    const el = tw.currentNode as Element;
    const href = el.getAttribute("href") || el.getAttribute("xlink:href") || "";

    if (href.startsWith("data:image/")) {
      handleDataImage(el, href, scene, groups);
    }

    walk(args, tw.nextNode());
  },
};

export function walk(args: WalkerArgs, nextNode: Node | null): void {
  if (!nextNode) {
    return;
  }

  const nodeName = nextNode.nodeName as keyof typeof walkers;
  if (walkers[nodeName]) {
    walkers[nodeName](args);
  } else {
    // Skip unrecognized nodes AND their entire subtree (e.g. mask, defs,
    // symbol, style, metadata). Without this, DOM implementations that
    // don't enforce the TreeWalker filter would descend into non-visual
    // containers and process their children as visible elements.
    walk(args, nextSiblingOf(args.tw));
  }
}
