import { buildPdf, type PdfMeta, type PdfPage, type PdfShape } from './pdf.js';
import { resolved } from './shapes.js';
import type { Drawing, Palette } from './types.js';

/** Bridge a garment drawing into the PDF writer's vocabulary. */
export function drawingToPdfPage(drawing: Drawing, palette: Palette): PdfPage {
  const shapes: PdfShape[] = resolved(drawing, palette).map(({ d, ink, evenOdd }) => ({
    d,
    cmyk: ink.cmyk,
    evenOdd,
  }));
  return { widthMm: drawing.widthMm, heightMm: drawing.heightMm, shapes };
}

/** A single-page, exact-size, CMYK print PDF for one placement. */
export function toPdf(drawing: Drawing, palette: Palette, meta: PdfMeta = {}): Promise<Uint8Array> {
  return buildPdf([drawingToPdfPage(drawing, palette)], meta);
}
