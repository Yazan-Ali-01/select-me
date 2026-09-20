import type { Drawing, Palette } from './types.js';
import { resolved } from './shapes.js';

export interface SvgOptions {
  /** Draw the garment behind the artwork. Preview only — never in a print file. */
  backgroundHex?: string;
  /** A short line of provenance in the file. */
  title?: string;
}

/**
 * Render to SVG at exact print size.
 *
 * Dimensions are in millimetres with a matching unitless viewBox, so the file
 * opens at its true physical size in Illustrator, Affinity and Inkscape alike
 * instead of arriving as an ambiguous pile of points.
 */
export function toSvg(drawing: Drawing, palette: Palette, options: SvgOptions = {}): string {
  const { widthMm, heightMm } = drawing;
  const body = resolved(drawing, palette)
    .map(({ d, ink, evenOdd }) =>
      `<path fill="${ink.hex}"${evenOdd ? ' fill-rule="evenodd"' : ''} d="${d}"/>`,
    )
    .join('');

  const bg = options.backgroundHex
    ? `<rect width="${widthMm}" height="${heightMm}" fill="${options.backgroundHex}"/>`
    : '';
  const title = options.title ? `<title>${escapeXml(options.title)}</title>` : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${heightMm}mm" ` +
    `viewBox="0 0 ${widthMm} ${heightMm}">${title}${bg}${body}</svg>`
  );
}

const escapeXml = (s: string) =>
  s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
