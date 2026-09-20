import { ADVANCE_EM, FIT_RATIO, MIN_TYPE_MM } from './spec.js';

/**
 * The one sizing rule in the whole design.
 *
 * A monospace line of `chars` characters occupies `chars * 0.6 em`. Solving that
 * against 99% of the column gives the size at which the line fills its measure
 * and still clears the trim edge. Fixed-size lines pass `max` and only ever
 * shrink; auto-sized lines leave it off and fill.
 */
export function fitSize(chars: number, columnMm: number, max = Infinity): number {
  if (chars <= 0) return max === Infinity ? MIN_TYPE_MM : max;
  const filled = (FIT_RATIO * columnMm) / (chars * ADVANCE_EM);
  return Math.min(max, filled);
}

/** Width a line will actually occupy, in mm. */
export function lineWidthMm(chars: number, sizeMm: number): number {
  return chars * ADVANCE_EM * sizeMm;
}

/** Characters IBM Plex Mono's Latin-1 subset does not carry. */
export function unsupportedChars(text: string): string[] {
  const bad = new Set<string>();
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (ch === '\n' || ch === '\t') continue;
    // Latin-1 plus the Latin Extended-A range the subset covers.
    const ok = (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0x17f);
    if (!ok) bad.add(ch);
  }
  return [...bad];
}

/** Collapse runs of whitespace and trim. Shirts have no room for double spaces. */
export function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Strip a URL down to what belongs on a shirt: no scheme, no trailing slash,
 * no "www.". The QR still encodes the full address — this is only the printed line.
 */
export function displayUrl(url: string): string {
  return tidy(url)
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '');
}

/** What the QR encodes: always absolute, so a phone camera opens it. */
export function qrUrl(url: string): string {
  const clean = tidy(url);
  if (!clean) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(clean)) return clean;
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) return `mailto:${clean}`;
  return `https://${clean.replace(/^\/+/, '')}`;
}
