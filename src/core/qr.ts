import qrcode from 'qrcode-generator';
import type { Shape } from './types.js';

export interface QrTile {
  shape: Shape;
  moduleCount: number;
  /** Physical size of one module, in mm. The number that decides whether it scans. */
  moduleMm: number;
}

/**
 * Build the QR tile as a single knockout path.
 *
 * The tile is one filled square in the accent ink, and every dark module is cut
 * out of it with the even-odd rule so the garment shows through. That is what
 * "knockout" means on the spec sheet, and it is why the artwork must never be
 * given a background: fill the holes and the code stops scanning.
 *
 * Polarity is right side up on a dark shirt — dark modules read as the garment,
 * light modules as ink.
 */
export function buildQrTile(
  text: string,
  opts: { x: number; y: number; sizeMm: number; quietModules: number; ecc: 'L' | 'M' | 'Q' | 'H' },
): QrTile {
  const { x, y, sizeMm, quietModules, ecc } = opts;

  const qr = qrcode(0, ecc);
  qr.addData(text);
  qr.make();

  const count = qr.getModuleCount();
  const moduleMm = sizeMm / (count + quietModules * 2);
  const originX = x + quietModules * moduleMm;
  const originY = y + quietModules * moduleMm;

  const n = (v: number) => v.toFixed(3);
  // The tile itself, wound first; the modules that follow become holes.
  const parts = [`M${n(x)},${n(y)} h${n(sizeMm)} v${n(sizeMm)} h-${n(sizeMm)} Z`];

  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!qr.isDark(row, col)) continue;
      parts.push(
        `M${n(originX + col * moduleMm)},${n(originY + row * moduleMm)} ` +
          `h${n(moduleMm)} v${n(moduleMm)} h-${n(moduleMm)} Z`,
      );
    }
  }

  return {
    shape: { kind: 'path', d: parts.join(' '), ink: 'accent', evenOdd: true },
    moduleCount: count,
    moduleMm,
  };
}
