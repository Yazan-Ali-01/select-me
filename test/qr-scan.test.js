import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import jsQR from 'jsqr';

import { EXAMPLE, layout, loadFonts, toSvg } from '../lib/core/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const fonts = await loadFonts(async (file) => {
  const buf = await readFile(join(HERE, '..', 'assets', 'fonts', file));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});

/**
 * Rasterise the QR straight out of the generated path data.
 *
 * This deliberately does not ask a renderer what the artwork looks like — it
 * reads the squares the generator actually wrote, applies the even-odd rule the
 * print file relies on, and hands the result to a real decoder. If the
 * knockout polarity, the quiet zone or the module grid is ever wrong, this
 * fails, and it fails before anyone pays for a screen.
 */
function decodeQrFromSvg(svg, { scale = 6 } = {}) {
  const d = svg.match(/<path fill="[^"]+" fill-rule="evenodd" d="([^"]+)"/)?.[1];
  assert.ok(d, 'the artwork has a knockout QR path');

  const squares = [...d.matchAll(/M([\d.]+),([\d.]+) h([\d.]+) v[\d.]+ h-[\d.]+ Z/g)].map((m) => ({
    x: Number(m[1]), y: Number(m[2]), size: Number(m[3]),
  }));

  const [tile, ...modules] = squares;
  const moduleMm = modules[0].size;
  // Snap to the module grid rather than to millimetres, so sampling cannot
  // drift across the tile and invent gaps the artwork does not have.
  const across = Math.round(tile.size / moduleMm);
  const px = across * scale;
  const data = new Uint8ClampedArray(px * px * 4).fill(255);

  // The tile prints in ink; every module square is a hole showing the garment.
  for (const m of modules) {
    const col = Math.round((m.x - tile.x) / moduleMm);
    const row = Math.round((m.y - tile.y) / moduleMm);
    for (let y = row * scale; y < (row + 1) * scale; y++) {
      for (let x = col * scale; x < (col + 1) * scale; x++) {
        const at = (y * px + x) * 4;
        data[at] = data[at + 1] = data[at + 2] = 0;
      }
    }
  }

  return jsQR(data, px, px);
}

test('the printed QR decodes to the link', () => {
  const design = layout({ ...EXAMPLE, url: 'yazan-ali.net/hi' }, fonts);
  const result = decodeQrFromSvg(toSvg(design.back, design.palette));
  assert.ok(result, 'a decoder found a code in the artwork');
  assert.equal(result.data, 'https://yazan-ali.net/hi', 'and it points at the right place');
});

test('every error-correction level still scans', () => {
  for (const ecc of ['L', 'M', 'Q', 'H']) {
    const design = layout({ ...EXAMPLE, url: 'https://example.com/portfolio', ecc }, fonts);
    const result = decodeQrFromSvg(toSvg(design.back, design.palette));
    assert.ok(result, `${ecc} produced a scannable code`);
    assert.equal(result.data, 'https://example.com/portfolio', `${ecc} decoded correctly`);
  }
});

test('a long link still scans, at a smaller module', () => {
  const url = 'https://example.com/a-really-quite-long-portfolio-address/with/deep/paths';
  const design = layout({ ...EXAMPLE, url }, fonts);
  const result = decodeQrFromSvg(toSvg(design.back, design.palette), { scale: 6 });
  assert.ok(result, 'still scannable');
  assert.equal(result.data, url);
  assert.ok(design.metrics.qrModules > 29, 'and it grew to fit');
});

test('an email address becomes a mailto code', () => {
  const design = layout({ ...EXAMPLE, url: 'hello@example.com' }, fonts);
  const result = decodeQrFromSvg(toSvg(design.back, design.palette));
  assert.equal(result?.data, 'mailto:hello@example.com');
});
