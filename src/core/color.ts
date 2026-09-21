import type { Ink } from './spec.js';

/** Accept `#FFAE3D`, `ffae3d`, `#fa3` — return `#FFAE3D`, or null if it isn't a colour. */
export function normalizeHex(value: string): string | null {
  const raw = value.trim().replace(/^#/, '');
  const expanded = raw.length === 3 ? [...raw].map((c) => c + c).join('') : raw;
  return /^[0-9a-f]{6}$/i.test(expanded) ? `#${expanded.toUpperCase()}` : null;
}

/**
 * RGB to CMYK, the plain conversion.
 *
 * This is the same arithmetic a shop's RIP would do given no colour profile, and
 * it is deliberately not dressed up as a managed conversion. For the presets the
 * CMYK values are measured rather than computed, which is why they carry a
 * Pantone reference and a custom colour does not.
 */
export function hexToCmyk(hex: string): [number, number, number, number] {
  const int = Number.parseInt(hex.slice(1), 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return [0, 0, 0, 1];
  return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k];
}

/** Build an ink from a hex string. Returns null if the string isn't a colour. */
export function inkFromHex(value: string, name = 'Custom'): Ink | null {
  const hex = normalizeHex(value);
  if (!hex) return null;
  return { hex, cmyk: hexToCmyk(hex), name };
}

/**
 * How much lighter the ink is than the garment, by WCAG relative luminance.
 *
 * A dark accent on a dark shirt is invisible long before it is subtle, and the
 * person choosing it is looking at a screenshot rather than a garment.
 */
export function contrastOnGarment(hex: string, garmentHex = '#111111'): number {
  const luminance = (value: string): number => {
    const int = Number.parseInt(value.slice(1), 16);
    const channel = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return (
      0.2126 * channel((int >> 16) & 255) +
      0.7152 * channel((int >> 8) & 255) +
      0.0722 * channel(int & 255)
    );
  };
  const a = luminance(hex) + 0.05;
  const b = luminance(garmentHex) + 0.05;
  return a > b ? a / b : b / a;
}
