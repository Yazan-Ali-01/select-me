import type { Drawing, Palette, Shape } from './types.js';
import type { Ink } from './spec.js';

/** Bezier constant for approximating a quarter circle. */
const KAPPA = 0.5522847498307936;

const n = (v: number) => {
  const s = v.toFixed(3);
  return s.replace(/\.?0+$/, '') || '0';
};

/** Every shape reduces to path data, so the renderers only ever handle one primitive. */
export function shapeToPath(shape: Shape): string {
  switch (shape.kind) {
    case 'path':
      return shape.d;
    case 'rect': {
      const { x, y, w, h } = shape;
      return `M${n(x)},${n(y)} L${n(x + w)},${n(y)} L${n(x + w)},${n(y + h)} L${n(x)},${n(y + h)} Z`;
    }
    case 'circle': {
      const { cx, cy, r } = shape;
      const k = r * KAPPA;
      return (
        `M${n(cx)},${n(cy - r)} ` +
        `C${n(cx + k)},${n(cy - r)} ${n(cx + r)},${n(cy - k)} ${n(cx + r)},${n(cy)} ` +
        `C${n(cx + r)},${n(cy + k)} ${n(cx + k)},${n(cy + r)} ${n(cx)},${n(cy + r)} ` +
        `C${n(cx - k)},${n(cy + r)} ${n(cx - r)},${n(cy + k)} ${n(cx - r)},${n(cy)} ` +
        `C${n(cx - r)},${n(cy - k)} ${n(cx - k)},${n(cy - r)} ${n(cx)},${n(cy - r)} Z`
      );
    }
  }
}

export const inkOf = (shape: Shape, palette: Palette): Ink =>
  shape.ink === 'accent' ? palette.accent : palette.white;

/** Flatten a drawing into paths paired with their resolved ink. */
export function resolved(drawing: Drawing, palette: Palette) {
  return drawing.shapes.map((s) => ({
    d: shapeToPath(s),
    ink: inkOf(s, palette),
    evenOdd: s.kind === 'path' && s.evenOdd === true,
  }));
}
