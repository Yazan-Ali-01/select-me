#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stdin, stdout } from 'node:process';

import {
  ACCENTS,
  DEFAULT_SORT_COLUMN,
  DEFAULTS,
  fileStem,
  inkFromHex,
  layout,
  loadFonts,
  toPdf,
  toSpecSheetPdf,
  toSvg,
  qrUrl,
  type Ink,
  type ShirtInput,
} from './core/index.js';

const SITE = 'https://selectme.vercel.app';

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
    --url <string>         Printed under the rule.
    --qr <string>          What the QR points at, if not the printed link.

    --headline <string>    The big line. Default: "${DEFAULTS.headline}"
    --updated <string>     Trailing comment. Default: "${DEFAULTS.updated}"
    --chest <string>       Chest subject. Default: "${DEFAULTS.chestSubject}"
    --chest-value <string> Chest value. Default: "${DEFAULTS.chestValue}"

  The query — every identifier and literal is yours
    SELECT {select} FROM {table}
    WHERE {field} = '{value}'
      AND {and-field} = {and-value}
    ORDER BY {sort} DESC LIMIT 1;

    --select <string>      Selected column. Default: "name"
    --table <string>       Table name. Default: derived from the title.
    --field <string>       Filter column. Default: derived from the title.
    --value <string>       Filter value. Default: derived from the title.
    --and-field <string>   Second filter column. Default: "available"
    --and-value <string>   Second filter value. Default: "true"
    --sort [<string>]      Add the sort line, ordering by this column.
                           Bare --sort uses "${DEFAULT_SORT_COLUMN}".

    --accent <name|hex>    ${ACCENTS.map((a) => a.name.toLowerCase().split(' ')[0]).join(', ')}, or any hex.
    --ecc <L|M|Q|H>        QR error correction. Default: Q.
    --out <dir>            Output directory. Default: ./<your-name>-shirt

    -h, --help             Show this.

  Output
    SVG and PDF for both placements, plus a print specification sheet.
    PNG needs a canvas, so it only comes out of the web tool at selectme.vercel.app.
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
  if (!value) return DEFAULTS.accent;
  const custom = inkFromHex(value);
  if (custom) {
    // A hex that matches a preset keeps the preset's measured CMYK and Pantone.
    return ACCENTS.find((a) => a.hex === custom.hex) ?? custom;
  }
  const match = ACCENTS.find((a) => a.name.toLowerCase().startsWith(value.trim().toLowerCase()));
  if (!match) {
    throw new Error(
      `Unknown accent "${value}". Try a hex like #FFAE3D, or one of: ${ACCENTS.map((a) => a.name).join(', ')}.`,
    );
  }
  return match;
}

async function ask(): Promise<Pick<ShirtInput, 'name' | 'title' | 'url'>> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    stdout.write('\n  select-me — three questions. Everything else has a default.\n\n');
    const name = (await rl.question(`  Your name       [${DEFAULTS.name}]  `)) || DEFAULTS.name;
    const title = (await rl.question(`  Your title      [${DEFAULTS.title}]  `)) || DEFAULTS.title;
    const url = (await rl.question(`  Your URL        [${DEFAULTS.url}]  `)) || DEFAULTS.url;
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

  const named = Boolean(args.name || args.title || args.url);
  const interactive = !named && stdin.isTTY;

  // With no terminal to ask through and nothing named, generating somebody
  // else's shirt is a strange thing to do quietly. Show the options instead.
  if (!named && !interactive) {
    stdout.write(HELP);
    return;
  }

  let answers: Awaited<ReturnType<typeof ask>> | null = null;
  if (interactive) {
    try {
      answers = await ask();
    } catch {
      // Ctrl+C, Ctrl+D, or a closed pipe. Leaving without a stack trace.
      stdout.write('\n  Nothing generated. Run with --help to pass the details as flags.\n\n');
      return;
    }
  }

  const input: ShirtInput = {
    ...DEFAULTS,
    ...(answers ?? {}),
    name: str(args.name) ?? answers?.name ?? DEFAULTS.name,
    title: str(args.title) ?? answers?.title ?? DEFAULTS.title,
    url: str(args.url) ?? answers?.url ?? DEFAULTS.url,
    headline: str(args.headline) ?? DEFAULTS.headline,
    updated: str(args.updated) ?? DEFAULTS.updated,
    chestSubject: str(args.chest) ?? DEFAULTS.chestSubject,
    chestValue: str(args['chest-value']) ?? DEFAULTS.chestValue,
    qrTarget: str(args.qr) ?? '',
    selectColumn: str(args.select),
    table: str(args.table),
    field: str(args.field),
    value: str(args.value),
    andField: str(args['and-field']),
    andValue: str(args['and-value']),
    // Bare --sort turns the line on without naming a column.
    sortBy: args.sort === true ? DEFAULT_SORT_COLUMN : (str(args.sort) ?? ''),
    accent: resolveAccent(str(args.accent)),
    ecc: (str(args.ecc)?.toUpperCase() as ShirtInput['ecc']) ?? DEFAULTS.ecc,
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

  const where = relative(process.cwd(), dir) || '.';

  stdout.write(`\n  ${design.query.join('\n  ')}\n\n`);
  if (design.metrics.qrTarget !== qrUrl(input.url)) {
    stdout.write(`  The QR points at ${design.metrics.qrTarget}\n\n`);
  }
  for (const warning of design.warnings) stdout.write(`  ! ${warning}\n`);
  if (design.warnings.length) stdout.write('\n');

  stdout.write(`  Wrote ${files.length} files to ${where}\n`);
  stdout.write('  Send the whole folder to your printer.\n\n');

  // Someone who answered three questions has no idea the rest of this exists.
  // Rather than interrogate them up front, show what they could have asked for.
  if (interactive) {
    stdout.write('  Those three answers, defaults for the rest. You can also set:\n\n');
    for (const [flag, what] of [
      ['--accent "#2ED3B7"', 'any hex, or ' + ACCENTS.map((a) => a.name.toLowerCase().split(' ')[0]).join(', ')],
      ['--sort', 'add ORDER BY fit DESC LIMIT 1; to the query'],
      ['--qr <url>', 'point the code somewhere other than the printed link'],
      ['--headline "..."', 'change the big line across the shoulders'],
      ['--table, --field, --value', 'rewrite any part of the query'],
      ['--help', 'all of it'],
    ] as const) {
      stdout.write(`    ${flag.padEnd(26)} ${what}\n`);
    }
    stdout.write('\n');
  }

  stdout.write(`  300 DPI PNGs, a live preview and a shareable link: ${SITE}\n\n`);
}

main().catch((error: unknown) => {
  process.exitCode = 1;
  stdout.write(`\n  ${error instanceof Error ? error.message : String(error)}\n\n`);
});
