import {
  ACCENTS,
  EXAMPLE,
  fileStem,
  layout,
  loadFonts,
  toPdf,
  toPngBlob,
  toSpecSheetPdf,
  toSvg,
  zip,
  type FontSet,
  type Ink,
  type ShirtDesign,
  type ShirtInput,
} from '../core/index.js';

/* --- state ---------------------------------------------------------------- */

/** Fields that travel in the share link. Anything left at its default is omitted. */
const SHARED = [
  'name', 'title', 'url', 'headline', 'updated',
  'chestSubject', 'chestValue', 'table', 'field', 'value', 'ecc',
] as const;

type SharedKey = (typeof SHARED)[number];

function readUrl(): Partial<ShirtInput> {
  const params = new URLSearchParams(location.hash.slice(1));
  const out: Record<string, unknown> = {};
  for (const key of SHARED) {
    const value = params.get(key);
    if (value !== null) out[key] = value;
  }
  const accent = params.get('ink');
  if (accent) {
    const match = ACCENTS.find((a) => a.hex.toLowerCase() === `#${accent.replace('#', '').toLowerCase()}`);
    if (match) out.accent = match;
  }
  return out as Partial<ShirtInput>;
}

function writeUrl(input: ShirtInput): string {
  const params = new URLSearchParams();
  for (const key of SHARED) {
    const value = input[key as SharedKey];
    if (value && value !== EXAMPLE[key as SharedKey]) params.set(key, String(value));
  }
  if (input.accent.hex !== EXAMPLE.accent.hex) params.set('ink', input.accent.hex.slice(1));
  const query = params.toString();
  return `${location.origin}${location.pathname}${query ? `#${query}` : ''}`;
}

const state: ShirtInput = { ...EXAMPLE, ...readUrl() };
let view: 'back' | 'front' = 'back';
let garment = '#111111';
let fonts: FontSet | null = null;
let design: ShirtDesign | null = null;

/* --- elements ------------------------------------------------------------- */

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element: ${sel}`);
  return el;
};

const cloth = $('#cloth');
const art = $('#art');
const docket = $('#docket');
const alerts = $('#alerts');
const downloadBtn = $<HTMLButtonElement>('#download');
const shareBtn = $<HTMLButtonElement>('#share');
const inkNote = $('#ink-note');
const dimW = $('#dim-w');
const dimH = $('#dim-h');

/* --- render --------------------------------------------------------------- */

const mm = (v: number) => `${v.toFixed(2)} mm`;

function paint(): void {
  if (!fonts) return;
  design = layout(state, fonts);

  const drawing = view === 'back' ? design.back : design.front;
  art.innerHTML = toSvg(drawing, design.palette, { backgroundHex: undefined });
  cloth.dataset.loading = 'false';

  dimW.textContent = `${drawing.widthMm} mm`;
  dimH.textContent = `${drawing.heightMm} mm`;

  const m = design.metrics;
  const rows: [string, string][] = [
    ['Trim size', `${drawing.widthMm} × ${drawing.heightMm} mm`],
    ['Screens', m.inks === 1 ? '1 per placement' : '2 per placement'],
    ['Query type', mm(m.queryMm)],
    ['QR module', `${m.qrModules}² at ${mm(m.qrModuleMm)}`],
  ];
  docket.innerHTML = rows
    .map(([label, value]) => `<li><b>${label}</b><span>${escape(value)}</span></li>`)
    .join('');

  alerts.innerHTML = design.warnings.map((w) => `<p class="alert">${escape(w)}</p>`).join('');

  document.documentElement.style.setProperty('--ink', state.accent.hex);
  history.replaceState(null, '', writeUrl(state));
}

const escape = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Typing should not re-outline 2,000 glyphs on every keystroke. */
function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return ((...args: never[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

const repaint = debounce(paint, 140);

/* --- inputs --------------------------------------------------------------- */

const FIELDS: SharedKey[] = [
  'name', 'title', 'url', 'headline', 'updated',
  'chestSubject', 'chestValue', 'table', 'field', 'value', 'ecc',
];

for (const key of FIELDS) {
  const el = document.querySelector<HTMLInputElement | HTMLSelectElement>(`#f-${key}`);
  if (!el) continue;

  // Derived query fields show what the title produced, as editable placeholder text.
  const initial = state[key] as string | undefined;
  if (initial !== undefined) el.value = initial;
  if (el instanceof HTMLInputElement) el.placeholder = String(EXAMPLE[key] ?? '');

  el.addEventListener('input', () => {
    setField(key, el.value);
    repaint();
  });
}

/** Typed writes, so an empty query override falls back to the derived value. */
function setField(key: SharedKey, value: string): void {
  switch (key) {
    case 'ecc':
      state.ecc = (value || EXAMPLE.ecc) as ShirtInput['ecc'];
      return;
    case 'table':
    case 'field':
    case 'value':
      state[key] = value || undefined;
      return;
    default:
      state[key] = value;
  }
}

/** Query overrides start blank so the derived value shows through as a placeholder. */
function refreshDerivedPlaceholders(): void {
  if (!design) return;
  const [, second, third] = design.query;
  const table = design.query[0]?.replace('SELECT name FROM ', '') ?? '';
  const filter = second?.match(/^WHERE (\S+) = '(.*)'$/);
  const set = (id: string, value: string) => {
    const el = document.querySelector<HTMLInputElement>(id);
    if (el && !el.value) el.placeholder = value;
  };
  set('#f-table', table);
  if (filter) {
    set('#f-field', filter[1]!);
    set('#f-value', filter[2]!);
  }
  void third;
}

/* --- ink shelf ------------------------------------------------------------ */

const accentRow = $('#accents');
accentRow.innerHTML = ACCENTS.map(
  (ink, i) =>
    `<button type="button" class="swatch${ink.hex === state.accent.hex ? ' is-on' : ''}" ` +
    `style="--swatch:${ink.hex}" data-ink="${i}" role="radio" ` +
    `aria-checked="${ink.hex === state.accent.hex}" aria-label="${escape(ink.name)}" title="${escape(ink.name)}"></button>`,
).join('');

function describeInk(ink: Ink): string {
  const cmyk = ink.cmyk.map((v) => Math.round(v * 100)).join('/');
  return ink.pantone
    ? `${ink.name} — ${ink.hex}, Pantone ${ink.pantone}, CMYK ${cmyk}`
    : `${ink.name} — ${ink.hex}, CMYK ${cmyk}`;
}

accentRow.addEventListener('click', (event) => {
  const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('.swatch');
  if (!btn) return;
  state.accent = ACCENTS[Number(btn.dataset.ink)]!;
  for (const el of accentRow.querySelectorAll('.swatch')) {
    const on = el === btn;
    el.classList.toggle('is-on', on);
    el.setAttribute('aria-checked', String(on));
  }
  inkNote.textContent = describeInk(state.accent);
  paint();
});
inkNote.textContent = describeInk(state.accent);

/* --- placement and garment ------------------------------------------------ */

for (const btn of document.querySelectorAll<HTMLButtonElement>('.placement')) {
  btn.addEventListener('click', () => {
    view = btn.dataset.view === 'front' ? 'front' : 'back';
    for (const other of document.querySelectorAll('.placement')) {
      const on = other === btn;
      other.classList.toggle('is-on', on);
      other.setAttribute('aria-selected', String(on));
    }
    paint();
  });
}

for (const chip of document.querySelectorAll<HTMLButtonElement>('.garment-chip')) {
  chip.addEventListener('click', () => {
    garment = chip.dataset.garment ?? '#111111';
    document.documentElement.style.setProperty('--cloth', garment);
    for (const other of document.querySelectorAll('.garment-chip')) other.classList.toggle('is-on', other === chip);
  });
}

/* --- handoff -------------------------------------------------------------- */

function save(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const encoder = new TextEncoder();

function readme(d: ShirtDesign): string {
  const cmyk = (ink: Ink) => ink.cmyk.map((v) => Math.round(v * 100)).join('/');
  return [
    `Shirt artwork for ${d.input.name}`,
    '',
    'PRINT-SPEC.pdf has the full instructions. The short version:',
    '',
    `  Back    270 x 182 mm, centred, top edge 82 mm below the collar seam.`,
    `  Front   100 x 20 mm, left chest, 65 mm below the collar seam,`,
    `          60 mm left of the garment centre line. Deliberately off-centre.`,
    `  Garment Solid black or solid charcoal. Not heather.`,
    '',
    `  Inks    ${d.palette.accent.name} ${d.palette.accent.hex} (CMYK ${cmyk(d.palette.accent)}` +
      `${d.palette.accent.pantone ? `, Pantone ${d.palette.accent.pantone}` : ''})`,
    `          White ${d.palette.white.hex}`,
    '',
    '  The QR square is a knockout: its dark modules are UNPRINTED and the',
    '  garment shows through them. Do not fill them and do not put a',
    '  background behind the tile, or the code stops scanning.',
    '',
    '  Artwork is at exact final size. Do not scale. Type is outlined, so',
    '  there is no font to install.',
    '',
    `  Query printed on the back:`,
    ...d.query.map((line) => `    ${line}`),
    '',
    'Generated with select-me — https://selectme.vercel.app',
    '',
  ].join('\n');
}

downloadBtn.addEventListener('click', async () => {
  if (!design || !fonts) return;
  const original = downloadBtn.textContent;
  downloadBtn.disabled = true;
  downloadBtn.textContent = 'Building the files…';

  try {
    const stem = fileStem(state.name);
    const meta = { author: state.name, creator: 'select-me' };
    const bytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

    const entries = [
      { name: 'README.txt', data: encoder.encode(readme(design)) },
      {
        name: 'back-print-270mm.svg',
        data: encoder.encode(toSvg(design.back, design.palette, { title: `${state.name} — back print` })),
      },
      {
        name: 'front-chest-100mm.svg',
        data: encoder.encode(toSvg(design.front, design.palette, { title: `${state.name} — front chest` })),
      },
      {
        name: 'back-print-270mm.pdf',
        data: await toPdf(design.back, design.palette, { ...meta, title: `${state.name} — back print` }),
      },
      {
        name: 'front-chest-100mm.pdf',
        data: await toPdf(design.front, design.palette, { ...meta, title: `${state.name} — front chest` }),
      },
      { name: 'back-print-270mm.png', data: await bytes(await toPngBlob(design.back, design.palette)) },
      { name: 'front-chest-100mm.png', data: await bytes(await toPngBlob(design.front, design.palette)) },
      { name: 'PRINT-SPEC.pdf', data: await toSpecSheetPdf(design, fonts) },
    ];

    save(new Blob([zip(entries) as BlobPart], { type: 'application/zip' }), `${stem}-shirt.zip`);
    downloadBtn.textContent = 'Downloaded';
  } catch (error) {
    downloadBtn.textContent = 'Could not build the files';
    alerts.innerHTML = `<p class="alert">${escape(
      error instanceof Error ? error.message : 'Something went wrong building the files.',
    )}</p>`;
  } finally {
    downloadBtn.disabled = false;
    setTimeout(() => {
      downloadBtn.textContent = original;
    }, 2400);
  }
});

shareBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(writeUrl(state));
  const original = shareBtn.textContent;
  shareBtn.textContent = 'Link copied';
  setTimeout(() => {
    shareBtn.textContent = original;
  }, 1800);
});

const npx = document.querySelector<HTMLElement>('.npx');
npx?.addEventListener('click', async () => {
  await navigator.clipboard.writeText(npx.dataset.copy ?? '');
  npx.classList.add('is-copied');
  setTimeout(() => npx.classList.remove('is-copied'), 1400);
});

/* --- boot ----------------------------------------------------------------- */

(async () => {
  try {
    fonts = await loadFonts(async (file) => {
      const response = await fetch(`/fonts/${file}`);
      if (!response.ok) throw new Error(`Could not load ${file}`);
      return response.arrayBuffer();
    });
    paint();
    refreshDerivedPlaceholders();
  } catch {
    cloth.dataset.loading = 'false';
    alerts.innerHTML =
      '<p class="alert">The fonts did not load, so nothing can be outlined. Check your connection and reload.</p>';
  }
})();
