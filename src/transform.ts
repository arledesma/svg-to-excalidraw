import Group from "./elements/Group";
import { vec3, mat4 } from "gl-matrix";

/**
 * Parse an SVG transform attribute string directly into a mat4.
 *
 * Supports: translate, scale, rotate, matrix, skewX, skewY.
 * This replaces the previous approach of converting to a CSS transform
 * string and parsing it with DOMMatrix, eliminating the browser dependency.
 */
function parseSVGTransform(svgTransformStr: string): mat4 {
  const result = mat4.create(); // identity

  const funcRe = /(\w+)\(([^)]*)\)/g;
  let match: RegExpExecArray | null;

  while ((match = funcRe.exec(svgTransformStr)) !== null) {
    const name = match[1];
    const args = match[2].split(/[\s,]+/).map(Number.parseFloat);
    const m = mat4.create();

    switch (name) {
      case "translate":
        mat4.fromTranslation(m, [args[0] || 0, args[1] || 0, 0]);
        break;

      case "scale": {
        const sx = args[0] || 1;
        const sy = args.length > 1 ? args[1] : sx;
        mat4.fromScaling(m, [sx, sy, 1]);
        break;
      }

      case "rotate": {
        const deg = args[0] || 0;
        const cx = args[1] || 0;
        const cy = args[2] || 0;
        const rad = (deg * Math.PI) / 180;

        if (cx !== 0 || cy !== 0) {
          // rotate(angle cx cy) = translate(cx,cy) rotate(angle) translate(-cx,-cy)
          const pre = mat4.fromTranslation(mat4.create(), [cx, cy, 0]);
          const rot = mat4.fromZRotation(mat4.create(), rad);
          const post = mat4.fromTranslation(mat4.create(), [-cx, -cy, 0]);
          mat4.multiply(m, pre, rot);
          mat4.multiply(m, m, post);
        } else {
          mat4.fromZRotation(m, rad);
        }
        break;
      }

      case "matrix":
        // SVG matrix(a,b,c,d,e,f) → column-major mat4
        if (args.length >= 6) {
          const [a, b, c, d, e, f] = args;
          // prettier-ignore
          mat4.set(m,
            a, b, 0, 0,
            c, d, 0, 0,
            0, 0, 1, 0,
            e, f, 0, 1,
          );
        }
        break;

      case "skewX": {
        const rad = ((args[0] || 0) * Math.PI) / 180;
        m[4] = Math.tan(rad);
        break;
      }

      case "skewY": {
        const rad = ((args[0] || 0) * Math.PI) / 180;
        m[1] = Math.tan(rad);
        break;
      }

      default:
        // Unsupported transform function — skip
        continue;
    }

    mat4.multiply(result, result, m);
  }

  return result;
}

export function getElementMatrix(el: Element): mat4 {
  const transform = el.getAttribute("transform");
  if (transform) {
    return parseSVGTransform(transform);
  }
  return mat4.create();
}

export function getTransformMatrix(el: Element, groups: Group[]): mat4 {
  const accumMat = groups
    .map(({ element }) => getElementMatrix(element))
    .concat([getElementMatrix(el)])
    .reduce((acc, m) => mat4.multiply(acc, acc, m), mat4.create());

  return accumMat;
}

export function transformPoints(
  points: number[][],
  transform: mat4,
): [number, number][] {
  return points.map(([x, y]) => {
    const [newX, newY] = vec3.transformMat4(
      vec3.create(),
      vec3.fromValues(x, y, 1),
      transform,
    );

    return [newX, newY];
  });
}
