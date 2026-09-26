import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULTS, layout, loadFonts, toSvg } from '../lib/core/index.js';
import { svgElements } from './svg-bbox.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const fonts = await loadFonts(async (file) => {
  const buf = await readFile(join(HERE, '..', 'assets', 'fonts', file));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});

/**
 * Baselines in this design are fixed while type sizes are computed, so a short
 * enough line will always try to set large enough to climb off the artwork.
 * Rather than test the handful of inputs that happened to break, this asserts
 * the invariant: nothing the generator draws may leave the print area.
 */
const CASES = [
  ['the original', {}],
  ['a three-letter title', { title: 'CTO' }],
  ['a short title', { title: 'Product Designer' }],
  ['a short headline', { headline: 'Hire me.' }],
  ['a one-word headline', { headline: 'Available.' }],
  ['both short', { title: 'CTO', headline: 'Hi.' }],
  ['a very long title', { title: 'Senior Staff Principal Software Reliability Engineer II' }],
  ['a long name', { name: 'Alexandra Papadopoulos-Whitfield' }],
  ['a long link', { url: 'https://example.com/a/rather/long/portfolio/path/indeed' }],
  ['a tiny query', { table: 'qa', field: 'x', value: 'y' }],
  ['a long query', { table: 'reliability_engineers', field: 'specialisation', value: 'distributed systems' }],
  ['a short chest line', { chestSubject: 'up', chestValue: 'y' }],
  ['a long chest line', { chestSubject: 'currently_interviewing', chestValue: 'absolutely' }],
  ['descenders everywhere', { name: 'Jppy Gygy', headline: 'Pay pygmy.', chestValue: 'jayyy' }],
  ['empty everything', { name: '', title: '', url: '', headline: '', chestSubject: '', chestValue: '' }],

  // The sort line adds a fourth query line, which moves the rule and the name
  // down a whole 14 mm. Everything below them has to still fit.
  ['the sort line', { sortBy: 'fit' }],
  ['the sort line and a long name', { sortBy: 'fit', name: 'Alexandra Papadopoulos-Whitfield' }],
  ['the sort line and a descending name', { sortBy: 'fit', name: 'Jayjay Gregory' }],
  ['the sort line and a long link', { sortBy: 'experience', url: 'example.com/a/long/portfolio/path' }],
  ['a long sort column', { sortBy: 'years_of_relevant_experience' }],
  ['every part replaced', {
    selectColumn: 'id', table: 'humans', field: 'stack', value: 'typescript',
    andField: 'notice_days', andValue: '0', sortBy: 'experience',
  }],
  ['a one-character query', {
    selectColumn: 'a', table: 'b', field: 'c', value: 'd', andField: 'e', andValue: 'f', sortBy: 'g',
  }],
];

for (const [label, overrides] of CASES) {
  test(`ink stays inside the artwork: ${label}`, () => {
    const design = layout({ ...DEFAULTS, ...overrides }, fonts);

    for (const which of ['front', 'back']) {
      const drawing = design[which];
      const elements = svgElements(toSvg(drawing, design.palette));
      assert.ok(elements.length > 0, `${which} drew something`);

      for (const [i, el] of elements.entries()) {
        // A hundredth of a millimetre of slack for rounding in the path data.
        const slack = 0.01;
        assert.ok(el.x0 >= -slack, `${which} element ${i} runs off the left: x0 ${el.x0.toFixed(2)}`);
        assert.ok(el.y0 >= -slack, `${which} element ${i} runs off the top: y0 ${el.y0.toFixed(2)}`);
        assert.ok(
          el.x1 <= drawing.widthMm + slack,
          `${which} element ${i} runs off the right: x1 ${el.x1.toFixed(2)} > ${drawing.widthMm}`,
        );
        assert.ok(
          el.y1 <= drawing.heightMm + slack,
          `${which} element ${i} runs off the bottom: y1 ${el.y1.toFixed(2)} > ${drawing.heightMm}`,
        );
      }
    }
  });
}

test('the query lines never grow into each other', () => {
  for (const overrides of [{}, { table: 'qa', field: 'x', value: 'y' }, { table: 'a', field: 'b', value: 'c' }]) {
    const design = layout({ ...DEFAULTS, ...overrides }, fonts);
    // Ink height of a line must stay under the 14 mm leading.
    assert.ok(design.metrics.queryMm * 0.9 <= 14.01, `query set at ${design.metrics.queryMm.toFixed(2)} mm`);
  }
});
