import type { Drawing, Palette } from './types.js';
import { resolved } from './shapes.js';
import { MM_PER_INCH, PRINT_DPI } from './spec.js';

export interface PngOptions {
  dpi?: number;
  /** Garment colour behind the art. Leave unset for the transparent print file. */
  backgroundHex?: string;
}

interface Canvas2D {
  width: number;
  height: number;
  getContext(id: '2d'): CanvasRenderingContext2D | null;
}

/**
 * Rasterise at print resolution.
 *
 * The paths are filled directly onto the canvas rather than round-tripping
 * through an <img> of the SVG, which keeps the canvas untainted and makes the
 * output byte-identical across browsers.
 */
export function drawOnCanvas(
  canvas: Canvas2D,
  drawing: Drawing,
  palette: Palette,
  options: PngOptions = {},
): void {
  const dpi = options.dpi ?? PRINT_DPI;
  const scale = dpi / MM_PER_INCH;

  canvas.width = Math.round(drawing.widthMm * scale);
  canvas.height = Math.round(drawing.heightMm * scale);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser did not give us a 2D canvas context.');

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (options.backgroundHex) {
    ctx.fillStyle = options.backgroundHex;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  for (const { d, ink, evenOdd } of resolved(drawing, palette)) {
    ctx.fillStyle = ink.hex;
    ctx.fill(new Path2D(d), evenOdd ? 'evenodd' : 'nonzero');
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** Browser only: a 300 DPI PNG with a transparent background, as the spec asks for. */
export async function toPngBlob(
  drawing: Drawing,
  palette: Palette,
  options: PngOptions = {},
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  drawOnCanvas(canvas, drawing, palette, options);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The browser could not encode the PNG.');
  return blob;
}
