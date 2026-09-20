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
export { drawOnCanvas, toPngBlob } from './png.js';

import { AMBER, ACCENTS } from './spec.js';
import type { ShirtInput } from './types.js';

/** The design that started this, used as the placeholder set in the UI and the CLI. */
export const EXAMPLE: ShirtInput = {
  name: 'Yazan Ali',
  title: 'Senior Software Engineer',
  url: 'yazan-ali.net/hi',
  headline: 'Your next hire.',
  updated: 'today',
  chestSubject: 'available',
  chestValue: 'true',
  accent: AMBER,
  ecc: 'Q',
};

export function normalizeInput(partial: Partial<ShirtInput>): ShirtInput {
  return { ...EXAMPLE, ...partial, accent: partial.accent ?? AMBER };
}

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
