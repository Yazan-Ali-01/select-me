import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ADVANCE_EM, BACK, EXAMPLE, FIT_RATIO, buildQrTile, deriveQuery, displayUrl,
  fileStem, fitSize, hexToCmyk, inkFromHex, layout, loadFonts, normalizeHex,
  pathToPdfOps, qrUrl, toPdf, toSpecSheetPdf, toSvg, unsupportedChars,
} from '../lib/core/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const fonts = await loadFonts(async (file) => {
  const buf = await readFile(join(HERE, '..', 'assets', 'fonts', file));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});

test('fitSize fills the column to the fit ratio', () => {
  const size = fitSize(24, 270);
  assert.ok(Math.abs(24 * ADVANCE_EM * size - 270 * FIT_RATIO) < 1e-9);
});

test('fitSize only ever shrinks a fixed size', () => {
  assert.equal(fitSize(4, 171.6, 14), 14, 'a short name keeps its nominal size');
  assert.ok(fitSize(60, 171.6, 14) < 14, 'a long name shrinks');
});

test('query derivation reads seniority and pluralises the role', () => {
  assert.deepEqual(deriveQuery('Senior Software Engineer'), {
    table: 'engineers', field: 'level', value: 'senior',
  });
  assert.deepEqual(deriveQuery('Staff Data Scientist'), {
    table: 'scientists', field: 'level', value: 'staff',
  });
  assert.deepEqual(deriveQuery('VP of Engineering'), {
    table: 'engineers', field: 'level', value: 'vp',
  }, 'an abstract noun still yields a table of people');
  assert.equal(deriveQuery('Product Designer').field, 'role', 'no seniority word means filter on role');
  assert.deepEqual(deriveQuery(''), { table: 'engineers', field: 'level', value: 'senior' });
});

test('URLs are trimmed for print but absolute for the QR', () => {
  assert.equal(displayUrl('https://www.example.com/hi/'), 'example.com/hi');
  assert.equal(qrUrl('example.com/hi'), 'https://example.com/hi');
  assert.equal(qrUrl('https://example.com'), 'https://example.com');
  assert.equal(qrUrl('me@example.com'), 'mailto:me@example.com');
});

test('characters outside the font subset are reported, not silently dropped', () => {
  assert.deepEqual(unsupportedChars('Yazan Ali'), []);
  assert.deepEqual(unsupportedChars('Zoë Ström'), []);
  assert.deepEqual(unsupportedChars('山田'), ['山', '田']);
});

test('the QR tile is a knockout that fills its square exactly', () => {
  const tile = buildQrTile('https://example.com', {
    x: BACK.qr.x, y: BACK.qr.y, sizeMm: BACK.qr.sizeMm, quietModules: 4, ecc: 'Q',
  });
  assert.equal(tile.shape.evenOdd, true, 'dark modules must be holes');
  assert.ok(tile.moduleCount >= 21);
  const span = (tile.moduleCount + 8) * tile.moduleMm;
  assert.ok(Math.abs(span - BACK.qr.sizeMm) < 1e-9, 'modules plus quiet zone fill the tile');
});

test('path translation handles every command the renderers emit', () => {
  assert.equal(pathToPdfOps('M1,2 L3,4 Z'), '1 2 m\n3 4 l\nh');
  assert.equal(pathToPdfOps('M0,0 h10 v10 h-10 Z'), '0 0 m\n10 0 l\n10 10 l\n0 10 l\nh');
  assert.match(pathToPdfOps('M0,0 Q1,1 2,0'), /c$/, 'quadratics are raised to cubics');
  assert.equal(pathToPdfOps('M0,0 1,1 2,2'), '0 0 m\n1 1 l\n2 2 l', 'implicit linetos after a moveto');
  assert.equal(pathToPdfOps(''), '');
});

test('a generated PDF is structurally sound', async () => {
  const design = layout({ ...EXAMPLE }, fonts);
  const bytes = await toPdf(design.back, design.palette, { title: 'test' });
  const text = Buffer.from(bytes).toString('latin1');

  assert.match(text, /^%PDF-1\.7/);
  assert.match(text, /%%EOF\n$/);

  // Page box must be the artwork size in points, to a tenth.
  const box = text.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
  assert.ok(box, 'MediaBox present');
  assert.ok(Math.abs(Number(box[1]) - 270 * 72 / 25.4) < 0.1);
  assert.ok(Math.abs(Number(box[2]) - 182 * 72 / 25.4) < 0.1);

  // Every xref offset must point at the object it claims.
  const startxref = Number(text.match(/startxref\n(\d+)/)[1]);
  const table = text.slice(startxref).match(/\d{10} \d{5} n/g);
  assert.ok(table.length >= 4, 'xref lists the objects');
  table.forEach((row, i) => {
    const at = Number(row.slice(0, 10));
    assert.match(text.slice(at, at + 20), new RegExp(`^${i + 1} 0 obj`), `object ${i + 1} offset`);
  });
});

test('the spec sheet is one A4 page', async () => {
  const design = layout({ ...EXAMPLE }, fonts);
  const text = Buffer.from(await toSpecSheetPdf(design, fonts)).toString('latin1');
  assert.match(text, /\/Count 1/);
  const box = text.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
  assert.ok(Math.abs(Number(box[1]) - 210 * 72 / 25.4) < 0.1, 'A4 width');
  assert.ok(Math.abs(Number(box[2]) - 297 * 72 / 25.4) < 0.1, 'A4 height');
});

test('long input warns instead of printing a smudge', () => {
  const design = layout(
    { ...EXAMPLE, title: 'Senior Staff Distinguished Principal Software Reliability Engineer II' },
    fonts,
  );
  assert.ok(design.warnings.length === 0 || design.warnings.every((w) => typeof w === 'string'));
  const svg = toSvg(design.back, design.palette);
  assert.ok(svg.includes('viewBox="0 0 270 182"'), 'the trim size never changes');
});

test('an empty-ish input still produces both placements', () => {
  const design = layout({ ...EXAMPLE, name: '', title: '', url: '' }, fonts);
  assert.ok(design.front.shapes.length > 0);
  assert.ok(design.back.shapes.length > 0);
});

test('filenames are slugged safely', () => {
  assert.equal(fileStem('Yazan Ali'), 'yazan-ali');
  assert.equal(fileStem('Zoë  Ström'), 'zoe-strom');
  assert.equal(fileStem('!!!'), 'shirt');
});

test('no generated output ever contains a non-finite coordinate', async () => {
  // opentype.js 2.0.0 emits a literal NaN from its own path serialiser on
  // multi-glyph paths. A raster previewer skips it; a print RIP does not.
  const design = layout({ ...EXAMPLE, name: 'Yazan Ali' }, fonts);
  for (const [label, drawing] of [['front', design.front], ['back', design.back]]) {
    const svg = toSvg(drawing, design.palette);
    assert.ok(!/NaN|undefined|Infinity/.test(svg), `${label} SVG has a bad number`);
  }
  const pdf = Buffer.from(await toPdf(design.back, design.palette)).toString('latin1');
  assert.ok(!pdf.includes('NaN'), 'PDF content stream has a bad number');
});

test('every letter and digit outlines cleanly at print size', () => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const design = layout({ ...EXAMPLE, name: alphabet.slice(0, 26), title: alphabet.toUpperCase() }, fonts);
  const svg = toSvg(design.back, design.palette);
  assert.ok(!/NaN|undefined/.test(svg));
  assert.ok(svg.length > 10_000, 'the glyphs actually made it into the file');
});

test('every part of the query is replaceable', () => {
  const design = layout(
    {
      ...EXAMPLE,
      selectColumn: 'id',
      table: 'humans',
      field: 'stack',
      value: 'typescript',
      andField: 'notice_days',
      andValue: '0',
      sortBy: 'experience',
    },
    fonts,
  );
  assert.deepEqual(design.query, [
    'SELECT id FROM humans',
    "WHERE stack = 'typescript'",
    '  AND notice_days = 0',
    'ORDER BY experience DESC LIMIT 1;',
  ]);
});

test('the statement terminates on whichever line is last', () => {
  const without = layout({ ...EXAMPLE }, fonts).query;
  assert.equal(without.length, 3);
  assert.ok(without[2].endsWith('true;'), 'ends on the AND line');

  const withSort = layout({ ...EXAMPLE, sortBy: 'fit' }, fonts).query;
  assert.equal(withSort.length, 4);
  assert.ok(withSort[2].endsWith('true'), 'the AND line loses its semicolon');
  assert.ok(withSort[3].endsWith('LIMIT 1;'), 'and the sort line gains one');
});

test('the sort line pushes the rule and the name down, not off', () => {
  const plain = layout({ ...EXAMPLE }, fonts);
  const sorted = layout({ ...EXAMPLE, sortBy: 'fit' }, fonts);

  const ruleOf = (d) => d.back.shapes.find((s) => s.kind === 'rect');
  assert.equal(ruleOf(plain).y, 113, 'the original rule position is unchanged');
  assert.equal(ruleOf(sorted).y, 127, 'one line lower with the sort line on');
  assert.equal(sorted.back.heightMm, 182, 'and the trim size never moves');
});

test('blank query parts fall back rather than printing nothing', () => {
  const design = layout(
    { ...EXAMPLE, selectColumn: '', table: '  ', field: undefined, andValue: '' },
    fonts,
  );
  assert.deepEqual(design.query, [
    'SELECT name FROM engineers',
    "WHERE level = 'senior'",
    '  AND available = true;',
  ]);
});

test('hex colours are accepted in any reasonable spelling', () => {
  assert.equal(normalizeHex('#ffae3d'), '#FFAE3D');
  assert.equal(normalizeHex('FFAE3D'), '#FFAE3D');
  assert.equal(normalizeHex('#fa3'), '#FFAA33');
  assert.equal(normalizeHex('nope'), null);
  assert.equal(normalizeHex(''), null);

  assert.deepEqual(hexToCmyk('#FFFFFF'), [0, 0, 0, 0]);
  assert.deepEqual(hexToCmyk('#000000'), [0, 0, 0, 1]);
  const amber = hexToCmyk('#FFAE3D').map((v) => Math.round(v * 100));
  assert.deepEqual(amber, [0, 32, 76, 0], 'close to the measured 0/36/79/0');

  assert.equal(inkFromHex('#2ED3B7')?.name, 'Custom');
  assert.equal(inkFromHex('rubbish'), null);
});

test('a custom ink reaches the PDF as CMYK', async () => {
  const accent = inkFromHex('#2ED3B7');
  const design = layout({ ...EXAMPLE, accent }, fonts);
  const pdf = Buffer.from(await toPdf(design.back, design.palette)).toString('latin1');
  const [c, m, y, k] = accent.cmyk.map((v) => Number(v.toFixed(4)));
  assert.ok(pdf.includes(`${c} ${m} ${y} ${k} k`.replace(/\.?0+(?= |$)/g, '')) || pdf.includes(' k'),
    'the custom ink is written as a CMYK fill');
  assert.ok(!pdf.includes('NaN'));
});
