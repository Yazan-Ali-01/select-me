#!/usr/bin/env node
/**
 * Build the font files the generator ships.
 *
 * Two formats, for two different jobs:
 *   assets/fonts/*.ttf    — opentype.js reads these to outline glyphs. It cannot
 *                           read WOFF2 without a decompressor, so the TTF is the
 *                           format the generator actually needs.
 *   public/fonts/*.woff2  — the page's own text. A third of the size, and needed
 *                           at first paint rather than at generate time.
 *
 * Both come from IBM Plex Mono's Latin-1 subset: full coverage for European
 * names at a third of the weight of the complete family.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decompress } from 'wawoff2';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'node_modules', '@ibm', 'plex-mono', 'fonts', 'split', 'woff2');
const WEIGHTS = ['Regular', 'Medium', 'SemiBold'];

await mkdir(join(ROOT, 'assets', 'fonts'), { recursive: true });
await mkdir(join(ROOT, 'public', 'fonts'), { recursive: true });

for (const weight of WEIGHTS) {
  const woff2 = await readFile(join(SRC, `IBMPlexMono-${weight}-Latin1.woff2`));
  const ttf = await decompress(woff2);

  await writeFile(join(ROOT, 'assets', 'fonts', `IBMPlexMono-${weight}.ttf`), ttf);
  await writeFile(join(ROOT, 'public', 'fonts', `IBMPlexMono-${weight}.ttf`), ttf);
  await writeFile(join(ROOT, 'public', 'fonts', `IBMPlexMono-${weight}.woff2`), woff2);

  const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
  console.log(`  ${weight.padEnd(9)} woff2 ${kb(woff2.length)}  ->  ttf ${kb(ttf.length)}`);
}
console.log('\n  Fonts rebuilt. IBM Plex Mono is licensed under the SIL OFL 1.1.');
