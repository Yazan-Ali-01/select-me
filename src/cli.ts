#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stdin, stdout } from 'node:process';

import {
  ACCENTS,
  EXAMPLE,
  fileStem,
  layout,
  loadFonts,
  toPdf,
  toSpecSheetPdf,
  toSvg,
  type Ink,
  type ShirtInput,
} from './core/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FONT_DIR = resolve(HERE, '..', 'assets', 'fonts');

const HELP = `
  select-me — generate a print-ready job-hunt shirt from one SQL query

  Usage
    npx select-me [options]

  Run with no options and it will ask for the three things it needs.

  Options
    --name <string>        Printed under the rule.
    --title <string>       Job title. Sets the kicker and seeds the query.
    --url <string>         Printed, and encoded into the QR tile.

    --headline <string>    The big line. Default: "${EXAMPLE.headline}"
    --updated <string>     Trailing comment. Default: "${EXAMPLE.updated}"
    --chest <string>       Chest subject. Default: "${EXAMPLE.chestSubject}"
    --chest-value <string> Chest value. Default: "${EXAMPLE.chestValue}"

    --table <string>       Override the derived table name.
    --field <string>       Override the derived filter column.
    --value <string>       Override the derived filter value.

    --accent <name|hex>    ${ACCENTS.map((a) => a.name.toLowerCase().split(' ')[0]).join(', ')}, or #RRGGBB.
    --ecc <L|M|Q|H>        QR error correction. Default: Q.
    --out <dir>            Output directory. Default: ./<your-name>-shirt

    -h, --help             Show this.

  Output
    SVG and PDF for both placements, plus a print specification sheet.
    PNG needs a canvas, so it only comes out of the web tool at select-me.dev.
`;

function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('-')) continue;
    const key = arg.replace(/^--?/, '');
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

const str = (v: string | true | undefined): string | undefined =>
  typeof v === 'string' ? v : undefined;

/** Accept an accent by name or as a raw hex, because people will paste a hex. */
function resolveAccent(value: string | undefined): Ink {
  if (!value) return EXAMPLE.accent;
  const hex = value.trim();
  if (/^#?[0-9a-f]{6}$/i.test(hex)) {
    const normalized = `#${hex.replace('#', '').toUpperCase()}`;
    const known = ACCENTS.find((a) => a.hex === normalized);
    if (known) return known;
    return { hex: normalized, cmyk: hexToCmyk(normalized), name: 'Custom' };
  }
  const match = ACCENTS.find((a) => a.name.toLowerCase().startsWith(hex.toLowerCase()));
  if (!match) {
    throw new Error(`Unknown accent "${value}". Try one of: ${ACCENTS.map((a) => a.name).join(', ')}.`);
  }
  return match;
}

/**
 * Naive RGB to CMYK. It is the same conversion a shop's RIP would do, and it is
 * honest about being a starting point rather than a colour-managed match.
 */
function hexToCmyk(hex: string): [number, number, number, number] {
  const int = Number.parseInt(hex.slice(1), 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  const k = 1 - Math.max(r, g, b);
  if (k === 1) return [0, 0, 0, 1];
  return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k];
}

async function ask(): Promise<Pick<ShirtInput, 'name' | 'title' | 'url'>> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    stdout.write('\n  select-me — three questions.\n\n');
    const name = (await rl.question(`  Your name       [${EXAMPLE.name}]  `)) || EXAMPLE.name;
    const title = (await rl.question(`  Your title      [${EXAMPLE.title}]  `)) || EXAMPLE.title;
    const url = (await rl.question(`  Your URL        [${EXAMPLE.url}]  `)) || EXAMPLE.url;
    return { name, title, url };
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    stdout.write(HELP);
    return;
  }

  const interactive = !args.name && !args.title && !args.url && stdin.isTTY;
  const answers = interactive ? await ask() : null;

  const input: ShirtInput = {
    ...EXAMPLE,
    ...(answers ?? {}),
    name: str(args.name) ?? answers?.name ?? EXAMPLE.name,
    title: str(args.title) ?? answers?.title ?? EXAMPLE.title,
    url: str(args.url) ?? answers?.url ?? EXAMPLE.url,
    headline: str(args.headline) ?? EXAMPLE.headline,
    updated: str(args.updated) ?? EXAMPLE.updated,
    chestSubject: str(args.chest) ?? EXAMPLE.chestSubject,
    chestValue: str(args['chest-value']) ?? EXAMPLE.chestValue,
    table: str(args.table),
    field: str(args.field),
    value: str(args.value),
    accent: resolveAccent(str(args.accent)),
    ecc: (str(args.ecc)?.toUpperCase() as ShirtInput['ecc']) ?? EXAMPLE.ecc,
  };

  if (!['L', 'M', 'Q', 'H'].includes(input.ecc)) {
    throw new Error(`--ecc must be L, M, Q or H (got "${input.ecc}").`);
  }

  const fonts = await loadFonts(async (file) => {
    const buf = await readFile(join(FONT_DIR, file));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  });

  const design = layout(input, fonts);
  const stem = fileStem(input.name);
  const dir = resolve(str(args.out) ?? `${stem}-shirt`);
  await mkdir(dir, { recursive: true });

  const meta = { author: input.name, creator: 'select-me' };
  const files: [string, string | Uint8Array][] = [
    ['front-chest-100mm.svg', toSvg(design.front, design.palette, { title: `${input.name} — front chest` })],
    ['back-print-270mm.svg', toSvg(design.back, design.palette, { title: `${input.name} — back print` })],
    ['front-chest-100mm.pdf', await toPdf(design.front, design.palette, { ...meta, title: `${input.name} — front chest` })],
    ['back-print-270mm.pdf', await toPdf(design.back, design.palette, { ...meta, title: `${input.name} — back print` })],
    ['PRINT-SPEC.pdf', await toSpecSheetPdf(design, fonts)],
  ];

  for (const [file, body] of files) await writeFile(join(dir, file), body);

  stdout.write(`\n  ${design.query.join('\n  ')}\n\n`);
  for (const warning of design.warnings) stdout.write(`  ! ${warning}\n`);
  if (design.warnings.length) stdout.write('\n');
  stdout.write(`  Wrote ${files.length} files to ${dir}\n`);
  stdout.write('  Send the whole folder to your printer. PNG: select-me.dev\n\n');
}

main().catch((error: unknown) => {
  process.exitCode = 1;
  stdout.write(`\n  ${error instanceof Error ? error.message : String(error)}\n\n`);
});
