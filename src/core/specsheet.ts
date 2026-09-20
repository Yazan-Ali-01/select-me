import { runToPath, type FontSet } from './fonts.js';
import { buildPdf, type Cmyk, type PdfPage, type PdfShape } from './pdf.js';
import { drawingToPdfPage } from './render.js';
import { ADVANCE_EM, BACK, FRONT, PLACEMENT, PRINT_DPI, type Weight } from './spec.js';
import type { ShirtDesign } from './types.js';

/**
 * The sheet that goes to the printer.
 *
 * Artwork alone never survives contact with a print shop: it carries no
 * placement, no ink list, and no warning about the one thing on this design that
 * can be silently ruined. This page carries all three, on the same vectors as
 * the artwork so it cannot describe a shirt that was never generated.
 */

const PAGE = { w: 210, h: 297, margin: 18 } as const;

const INK: Record<string, Cmyk> = {
  black: [0, 0, 0, 1],
  body: [0, 0, 0, 0.78],
  muted: [0, 0, 0, 0.52],
  rule: [0, 0, 0, 0.14],
  panel: [0, 0, 0, 0.9],
  warnBg: [0, 0.08, 0.06, 0.02],
  warn: [0, 0.75, 0.6, 0.12],
};

interface Ctx {
  fonts: FontSet;
  shapes: PdfShape[];
}

function text(
  ctx: Ctx,
  content: string,
  o: { x: number; baseline: number; size: number; weight?: Weight; cmyk?: Cmyk },
): void {
  if (!content) return;
  const d = runToPath(ctx.fonts[o.weight ?? 400], content, {
    sizeMm: o.size,
    penXMm: o.x,
    baselineMm: o.baseline,
  });
  if (d) ctx.shapes.push({ d, cmyk: o.cmyk ?? INK.body! });
}

function box(ctx: Ctx, x: number, y: number, w: number, h: number, cmyk: Cmyk): void {
  ctx.shapes.push({ d: `M${x},${y} L${x + w},${y} L${x + w},${y + h} L${x},${y + h} Z`, cmyk });
}

/** Monospace makes wrapping arithmetic rather than measurement. */
function wrap(content: string, widthMm: number, size: number): string[] {
  const max = Math.max(1, Math.floor(widthMm / (ADVANCE_EM * size)));
  const lines: string[] = [];
  let line = '';
  for (const word of content.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** A label/value row, with the value wrapped into the remaining measure. */
function row(ctx: Ctx, y: number, label: string, value: string, opts = { size: 3 }): number {
  const labelX = PAGE.margin;
  const valueX = PAGE.margin + 34;
  const valueW = PAGE.w - PAGE.margin - valueX;
  const lines = wrap(value, valueW, opts.size);

  text(ctx, label, { x: labelX, baseline: y, size: opts.size, weight: 500, cmyk: INK.muted! });
  lines.forEach((line, i) => {
    text(ctx, line, { x: valueX, baseline: y + i * opts.size * 1.45, size: opts.size, cmyk: INK.body! });
  });

  const bottom = y + (lines.length - 1) * opts.size * 1.45 + 3.2;
  ctx.shapes.push({
    d: `M${labelX},${bottom} L${PAGE.w - PAGE.margin},${bottom} L${PAGE.w - PAGE.margin},${bottom + 0.12} L${labelX},${bottom + 0.12} Z`,
    cmyk: INK.rule!,
  });
  return bottom + 5.2;
}

function heading(ctx: Ctx, y: number, label: string): number {
  text(ctx, label, { x: PAGE.margin, baseline: y, size: 3.4, weight: 600, cmyk: INK.black! });
  return y + 6;
}

/** Drop a placement's artwork into a dark panel, scaled to fit. */
function preview(
  ctx: Ctx,
  design: ShirtDesign,
  which: 'front' | 'back',
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const drawing = design[which];
  box(ctx, x, y, w, h, INK.panel!);

  const pad = 7;
  const scale = Math.min((w - pad * 2) / drawing.widthMm, (h - pad * 2 - 6) / drawing.heightMm);
  const tx = x + (w - drawing.widthMm * scale) / 2;
  const ty = y + (h - 6 - drawing.heightMm * scale) / 2;

  for (const shape of drawingToPdfPage(drawing, design.palette).shapes) {
    ctx.shapes.push({ ...shape, transform: [scale, 0, 0, scale, tx, ty] });
  }

  const caption = which === 'front' ? PLACEMENT.front.label : PLACEMENT.back.label;
  const size = 2.4;
  text(ctx, caption, {
    x: x + (w - caption.length * ADVANCE_EM * size) / 2,
    baseline: y + h - 3.4,
    size,
    weight: 500,
    cmyk: [0, 0, 0, 0.35],
  });
}

export function specSheetPage(design: ShirtDesign, fonts: FontSet): PdfPage {
  const ctx: Ctx = { fonts, shapes: [] };
  const { palette, input } = design;
  const accent = palette.accent;

  text(ctx, `Print specification — ${input.name}`, {
    x: PAGE.margin,
    baseline: 26,
    size: 5.4,
    weight: 600,
    cmyk: INK.black!,
  });

  const intro =
    'Two placements, two ink colours, solid black or solid charcoal garment. Artwork supplied at exact final size as ' +
    `${PRINT_DPI} DPI transparent PNG and vector PDF.`;
  wrap(intro, PAGE.w - PAGE.margin * 2, 3).forEach((line, i) => {
    text(ctx, line, { x: PAGE.margin, baseline: 32.5 + i * 4.3, size: 3, cmyk: INK.muted! });
  });

  const panelY = 45;
  const panelW = (PAGE.w - PAGE.margin * 2 - 6) / 2;
  preview(ctx, design, 'front', PAGE.margin, panelY, panelW, 62);
  preview(ctx, design, 'back', PAGE.margin + panelW + 6, panelY, panelW, 62);

  let y = panelY + 62 + 14;

  y = heading(ctx, y, 'Placement');
  y = row(
    ctx,
    y,
    'Front',
    `${FRONT.widthMm} × ${FRONT.heightMm} mm. Left chest. Top edge ${PLACEMENT.front.belowCollarMm} mm below the collar seam; left edge ${PLACEMENT.front.leftOfCentreMm} mm left of the garment centre line.`,
  );
  y = row(
    ctx,
    y,
    'Back',
    `${BACK.widthMm} × ${BACK.heightMm} mm. Horizontally centred. Top edge ${PLACEMENT.back.belowCollarMm} mm below the collar seam.`,
  );
  y = row(ctx, y, 'Garment', PLACEMENT.garment);

  y += 3;
  y = heading(ctx, y, 'Inks');
  for (const ink of [accent, palette.white]) {
    // Border first, fill inset over it — white ink needs an edge on white paper.
    box(ctx, PAGE.margin - 0.2, y - 3, 3.6, 3.6, INK.rule!);
    box(ctx, PAGE.margin, y - 2.8, 3.2, 3.2, ink.cmyk);
    text(ctx, ink.name, { x: PAGE.margin + 5.5, baseline: y, size: 3, weight: 500, cmyk: INK.muted! });
    const cmyk = ink.cmyk.map((v) => Math.round(v * 100)).join('/');
    const detail = ink.pantone
      ? `${ink.hex}  ·  Pantone ${ink.pantone}  ·  CMYK ${cmyk}`
      : `${ink.hex}  ·  CMYK ${cmyk}`;
    text(ctx, detail, { x: PAGE.margin + 34, baseline: y, size: 3, cmyk: INK.body! });
    y += 6;
  }

  y += 4;
  const warnLines = wrap(
    'The QR code is a knockout. The squares inside the accent tile are unprinted — the garment shows through them. Do not fill them, do not put a background behind the tile, and do not resize the tile below ' +
      `${BACK.qr.sizeMm} mm. Please scan the first printed sample with a phone before running the batch.`,
    PAGE.w - PAGE.margin * 2 - 12,
    3,
  );
  const warnH = warnLines.length * 4.3 + 6;
  box(ctx, PAGE.margin, y - 4, PAGE.w - PAGE.margin * 2, warnH, INK.warnBg!);
  box(ctx, PAGE.margin, y - 4, 0.9, warnH, INK.warn!);
  warnLines.forEach((line, i) => {
    text(ctx, line, {
      x: PAGE.margin + 6,
      baseline: y + 1 + i * 4.3,
      size: 3,
      weight: i === 0 ? 500 : 400,
      cmyk: INK.black!,
    });
  });
  y += warnH + 6;

  y = heading(ctx, y, 'Notes');
  const notes = [
    'Two ink colours total. If screen printing, that is two screens per placement.',
    'DTG: white underbase under both inks. Do not underbase the knockout squares.',
    'Do not scale, do not add a white box, do not re-centre — the front print is deliberately off-centre.',
    'All type is IBM Plex Mono, converted to outlines. No fonts to install, nothing to substitute.',
    `Files: front-chest-${FRONT.widthMm}mm and back-print-${BACK.widthMm}mm, each as .png, .pdf and .svg.`,
  ];
  for (const note of notes) {
    const lines = wrap(note, PAGE.w - PAGE.margin * 2 - 6, 3);
    text(ctx, '•', { x: PAGE.margin, baseline: y, size: 3, cmyk: INK.muted! });
    lines.forEach((line, i) => {
      text(ctx, line, { x: PAGE.margin + 5, baseline: y + i * 4.3, size: 3, cmyk: INK.body! });
    });
    y += lines.length * 4.3 + 1.4;
  }

  text(ctx, `Generated with select-me · ${input.url}`, {
    x: PAGE.margin,
    baseline: PAGE.h - 12,
    size: 2.6,
    cmyk: INK.muted!,
  });

  return { widthMm: PAGE.w, heightMm: PAGE.h, shapes: ctx.shapes };
}

export function toSpecSheetPdf(design: ShirtDesign, fonts: FontSet): Promise<Uint8Array> {
  return buildPdf([specSheetPage(design, fonts)], {
    title: `Print specification — ${design.input.name}`,
    author: design.input.name,
    subject: 'Garment print specification',
    creator: 'select-me',
  });
}
