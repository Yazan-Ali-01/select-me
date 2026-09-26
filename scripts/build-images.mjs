#!/usr/bin/env node
/**
 * Render the README and social images from the generator itself, so the
 * pictures can never show a design the code does not produce.
 *
 * Needs a local Chrome to rasterise. Everything it makes is committed, so this
 * only has to run when the artwork changes.
 */
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { DEFAULTS, layout, loadFonts, toSvg } from '../lib/core/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const fonts = await loadFonts(async (file) => {
  const buf = await readFile(join(ROOT, 'assets', 'fonts', file));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});
const design = layout({ ...DEFAULTS }, fonts);

const page = (body, css) => `<!doctype html><meta charset="utf-8"><style>
  @font-face{font-family:PM;font-weight:600;src:url(file://${ROOT}/public/fonts/IBMPlexMono-SemiBold.woff2) format('woff2')}
  *{margin:0;box-sizing:border-box}
  body{background:#131211;font-family:PM,monospace;-webkit-font-smoothing:antialiased}
  svg{display:block;width:100%;height:auto}
  ${css}</style>${body}`;

const shot = async (html, { width, height, out }) => {
  const dir = join(tmpdir(), `select-me-shot-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'page.html');
  await writeFile(file, html);

  await new Promise((resolve, reject) => {
    const child = spawn(CHROME, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars',
      '--force-device-scale-factor=2', '--virtual-time-budget=4000',
      `--window-size=${width},${height}`, `--screenshot=${out}`, `file://${file}`,
    ]);
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Chrome exited ${code}`))));
  });
  await rm(dir, { recursive: true, force: true });
  console.log(`  ${out.replace(`${ROOT}/`, '')}`);
};

const art = toSvg(design.back, design.palette);

await mkdir(join(ROOT, 'docs'), { recursive: true });

await shot(
  page(`<div class="f">${art}</div>`, `.f{background:#111;padding:46px 54px}`),
  { width: 1200, height: 828, out: join(ROOT, 'docs', 'back-print.png') },
);

await shot(
  page(
    `<div class="card"><div class="art">${art}</div>
     <div class="foot"><span class="dot"></span>select-me<em>selectme.vercel.app</em></div></div>`,
    /* The art box takes the space the footer leaves, and the SVG's own
       viewBox letterboxes inside it — so the card can never crop the artwork. */
    `.card{width:1200px;height:630px;padding:48px 60px;display:flex;flex-direction:column;gap:26px}
     .art{flex:1;min-height:0;background:#111;border:1px solid #302e2a;border-radius:3px;
          padding:26px 34px;display:flex}
     .art svg{width:100%;height:100%}
     .foot{display:flex;align-items:center;gap:13px;color:#f3f1ec;font-size:24px;letter-spacing:-.02em}
     .dot{width:16px;height:16px;border-radius:50%;background:#ffae3d}
     em{margin-left:auto;font-style:normal;color:#96918a}`,
  ),
  { width: 1200, height: 630, out: join(ROOT, 'public', 'og.png') },
);
