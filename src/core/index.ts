export * from './spec.js';
export * from './types.js';
export * from './text.js';
export * from './query.js';
export * from './fonts.js';
export * from './qr.js';
export * from './shapes.js';
export * from './layout.js';
export * from './svg.js';
export * from './pdf.js';
export * from './render.js';
export * from './specsheet.js';
export * from './zip.js';
export * from './color.js';
export { drawOnCanvas, toPngBlob } from './png.js';

import { AMBER, ACCENTS, PLACEHOLDER } from './spec.js';
import type { ShirtInput } from './types.js';

/**
 * What the tool stands in for while the fields are still empty.
 *
 * These are placeholders, not anybody's details: the point is that the preview
 * looks like a finished shirt the moment the page loads, and that every one of
 * these words is obviously yours to replace. The job title is left as a real
 * one because it is what makes the derived query read like a query.
 */
export const DEFAULTS: ShirtInput = {
  name: PLACEHOLDER.name,
  title: PLACEHOLDER.title,
  url: PLACEHOLDER.url,
  // Empty: the code points at the printed link.
  qrTarget: '',
  headline: 'Your next hire.',
  updated: 'today',
  chestSubject: 'available',
  chestValue: 'true',
  // Off by default, so the query ends on the line that matters.
  sortBy: '',
  accent: AMBER,
  ecc: 'Q',
};

export function normalizeInput(partial: Partial<ShirtInput>): ShirtInput {
  return { ...DEFAULTS, ...partial, accent: partial.accent ?? AMBER };
}

/** What the sort line uses when someone turns it on without naming a column. */
export const DEFAULT_SORT_COLUMN = 'fit';

export { ACCENTS };

/** Slug used for the downloaded filenames. */
export function fileStem(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'shirt';
}
