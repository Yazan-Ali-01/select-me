import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULTS, layout, loadFonts, toSvg } from '../lib/core/index.js';
import { svgElements } from './svg-bbox.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FONT_DIR = join(HERE, '..', 'assets', 'fonts');

const fonts = await loadFonts(async (file) => {
  const buf = await readFile(join(FONT_DIR, file));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});

/**
 * The shirt this project was reverse-engineered from. Regenerating it from the
 * published layout rules has to land on the original artwork, or the rules are
 * wrong. Tolerance is a hundredth of a millimetre — far below what any press
 * can hold, which is the point: this catches drift, not print error.
 */
const TOLERANCE_MM = 0.02;

/**
 * The one known, deliberate difference. The original headline was set 0.7%
 * smaller than the uniform fit rule produces; the generator applies one rule
 * everywhere rather than carrying a hand-tuned exception.
 */
const KNOWN_DIFFERENCES = { 'back-print-270mm.svg': [1] };

/**
 * The inputs that produced the artwork in test/fixtures.
 *
 * They live here rather than in the library's defaults because they are one
 * person's details — a fixture for this comparison, not a stand-in the tool
 * should ever put in front of someone else.
 */
const ORIGINAL = {
  ...DEFAULTS,
  name: 'Yazan Ali',
  title: 'Senior Software Engineer',
  url: 'yazan-ali.net/hi',
};

const design = layout(ORIGINAL, fonts);
const generated = {
  'front-chest-100mm.svg': toSvg(design.front, design.palette),
  'back-print-270mm.svg': toSvg(design.back, design.palette),
};

for (const [file, svg] of Object.entries(generated)) {
  test(`${file} reproduces the original artwork`, async () => {
    const original = svgElements(await readFile(join(HERE, 'fixtures', file), 'utf8'));
    const actual = svgElements(svg);

    assert.equal(actual.length, original.length, 'element count');

    const exempt = new Set(KNOWN_DIFFERENCES[file] ?? []);
    actual.forEach((el, i) => {
      assert.equal(el.fill, original[i].fill, `element ${i} ink`);
      if (exempt.has(i)) return;
      for (const edge of ['x0', 'y0', 'x1', 'y1']) {
        const delta = Math.abs(el[edge] - original[i][edge]);
        assert.ok(
          delta <= TOLERANCE_MM,
          `element ${i} ${edge}: ${el[edge].toFixed(3)} vs ${original[i][edge].toFixed(3)} (${delta.toFixed(3)} mm off)`,
        );
      }
    });
  });
}

test('the headline difference stays within 1%', async () => {
  const original = svgElements(await readFile(join(HERE, 'fixtures', 'back-print-270mm.svg'), 'utf8'))[1];
  const actual = svgElements(generated['back-print-270mm.svg'])[1];
  const ratio = (actual.x1 - actual.x0) / (original.x1 - original.x0);
  assert.ok(ratio > 1 && ratio < 1.01, `headline is ${((ratio - 1) * 100).toFixed(2)}% wider`);
});
