import * as opentypeModule from 'opentype.js';
import type { Font, PathCommand } from 'opentype.js';

/**
 * opentype.js publishes a CommonJS `main` and an ES `module` with different
 * shapes: Node resolves the CommonJS one and offers only a default export,
 * while a bundler resolves the ES one and offers only named exports. Reading
 * through both is what lets this library work in Node, in a browser bundle and
 * in someone else's app without asking them to configure anything.
 */
const namespace: Record<string, unknown> = opentypeModule;
const opentype = (namespace.default ?? namespace) as typeof opentypeModule;
import { ADVANCE_EM, FONT_FILES, type Weight } from './spec.js';

export type LoadedFont = Font;
export type FontSet = Record<Weight, LoadedFont>;

/** How the caller gets us bytes. Differs between the browser and the CLI. */
export type FontLoader = (file: string) => Promise<ArrayBuffer>;

export async function loadFonts(load: FontLoader): Promise<FontSet> {
  const weights = Object.keys(FONT_FILES).map(Number) as Weight[];
  const parsed = await Promise.all(
    weights.map(async (w) => [w, opentype.parse(await load(FONT_FILES[w]))] as const),
  );
  return Object.fromEntries(parsed) as FontSet;
}

/** Advance of one character, in mm, at the given type size. Monospace, so no exceptions. */
export function advanceMm(sizeMm: number): number {
  return sizeMm * ADVANCE_EM;
}

/**
 * The ink box of a run, in em units, laid out on the monospace grid starting at
 * character `from`. Spaces contribute advance but no ink, which is what lets the
 * layout sit a line flush against x = 0 instead of against its left sidebearing.
 */
export function inkBox(
  font: LoadedFont,
  text: string,
  from = 0,
  to = text.length,
): { x0: number; x1: number; y0: number; y1: number } | null {
  const upem = font.unitsPerEm;
  const adv = ADVANCE_EM * upem;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  let any = false;

  for (let i = from; i < to; i++) {
    const ch = text[i];
    if (ch === undefined || ch === ' ') continue;
    const box = font.charToGlyph(ch).getBoundingBox();
    if (!Number.isFinite(box.x1) || !Number.isFinite(box.x2)) continue;
    const pen = i * adv;
    any = true;
    x0 = Math.min(x0, pen + box.x1);
    x1 = Math.max(x1, pen + box.x2);
    y0 = Math.min(y0, box.y1);
    y1 = Math.max(y1, box.y2);
  }
  if (!any) return null;
  return { x0: x0 / upem, x1: x1 / upem, y0: y0 / upem, y1: y1 / upem };
}

/** Height of the ascender band ('b' is the tallest lowercase), in em. Used for optical centring. */
export function ascenderEm(font: LoadedFont): number {
  return font.charToGlyph('b').getBoundingBox().y2 / font.unitsPerEm;
}

/**
 * Serialise path commands to SVG path data.
 *
 * opentype.js has its own serialiser, but its optimiser drops a coordinate on
 * multi-glyph paths and emits a literal `NaN` into the output — which a raster
 * previewer silently skips and a print RIP does not. Owning ~25 lines is the
 * cheaper risk for artwork that gets sent to a press.
 */
function commandsToPathData(commands: PathCommand[], decimals = 3): string {
  const n = (v: number): string => {
    if (!Number.isFinite(v)) throw new Error('Glyph outline produced a non-finite coordinate.');
    const fixed = v.toFixed(decimals);
    // Trim trailing zeros; keep the file small without losing a micron.
    const trimmed = fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
    return trimmed === '-0' || trimmed === '' ? '0' : trimmed;
  };

  let out = '';
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M': out += `M${n(cmd.x)} ${n(cmd.y)}`; break;
      case 'L': out += `L${n(cmd.x)} ${n(cmd.y)}`; break;
      case 'C': out += `C${n(cmd.x1)} ${n(cmd.y1)} ${n(cmd.x2)} ${n(cmd.y2)} ${n(cmd.x)} ${n(cmd.y)}`; break;
      case 'Q': out += `Q${n(cmd.x1)} ${n(cmd.y1)} ${n(cmd.x)} ${n(cmd.y)}`; break;
      case 'Z': out += 'Z'; break;
    }
  }
  return out;
}

/**
 * Outline a run as SVG path data, positioned in millimetres.
 *
 * The output carries no font reference at all — every glyph is a filled contour.
 * That is deliberate: a print shop that does not have IBM Plex Mono installed
 * still gets the right shapes, which is the single most common way artwork
 * arrives wrong.
 */
export function runToPath(
  font: LoadedFont,
  text: string,
  opts: { from?: number; to?: number; sizeMm: number; penXMm: number; baselineMm: number },
): string {
  const { from = 0, to = text.length, sizeMm, penXMm, baselineMm } = opts;
  const adv = advanceMm(sizeMm);
  const commands: PathCommand[] = [];

  for (let i = from; i < to; i++) {
    const ch = text[i];
    if (ch === undefined || ch === ' ') continue;
    const glyph = font.charToGlyph(ch);
    commands.push(...glyph.getPath(penXMm + i * adv, baselineMm, sizeMm).commands);
  }
  return commandsToPathData(commands);
}
