import {
  ACCENTS,
  DEFAULT_SORT_COLUMN,
  DEFAULTS,
  contrastOnGarment,
  inkFromHex,
  qrUrl,
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
  'name', 'title', 'url', 'qrTarget', 'headline', 'updated',
  'chestSubject', 'chestValue',
  'selectColumn', 'table', 'field', 'value', 'andField', 'andValue', 'sortBy',
  'ecc',
] as const;

/** The parts of the query the inline editor writes into. */
const QUERY_KEYS = [
  'selectColumn', 'table', 'field', 'value', 'andField', 'andValue', 'sortBy',
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
    const ink = inkFromHex(accent);
    // A shared hex that matches a preset keeps the preset's measured values.
    if (ink) out.accent = ACCENTS.find((a) => a.hex === ink.hex) ?? ink;
  }
  return out as Partial<ShirtInput>;
}

function writeUrl(input: ShirtInput): string {
  const params = new URLSearchParams();
  for (const key of SHARED) {
    const value = input[key as SharedKey];
    if (value && value !== DEFAULTS[key as SharedKey]) params.set(key, String(value));
  }
  if (input.accent.hex !== DEFAULTS.accent.hex) params.set('ink', input.accent.hex.slice(1));
  const query = params.toString();
  return `${location.origin}${location.pathname}${query ? `#${query}` : ''}`;
}

const shared = readUrl();
const state: ShirtInput = { ...DEFAULTS, ...shared };

// Name, title and link start blank so the defaults show through as
// placeholders. Nobody arriving here should have to clear out somebody else's
// details before they can type their own — and the preview still renders a
// finished shirt, because the layout stands in for whatever is empty.
for (const key of ['name', 'title', 'url'] as const) {
  if (shared[key] === undefined) state[key] = '';
}
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
const qrEncodes = $('#qr-encodes');
const colorInput = $<HTMLInputElement>('#f-color');
const hexInput = $<HTMLInputElement>('#f-hex');
const sortToggle = $<HTMLInputElement>('#f-sortOn');
const qrTargetInput = $<HTMLInputElement>('#f-qrTarget');
const sortLine = $('#q-sort-line');
const semiAnd = $('#q-semi-and');
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

  // Say out loud what the code will actually open, but only when that is not
  // simply the printed link — confirming the obvious is noise.
  // Compare against the link that will actually print — including the
  // placeholder standing in for an empty box — or a blank field makes the two
  // look different and the tool announces an override nobody asked for.
  const printed = qrUrl(state.url.trim() || DEFAULTS.url);
  qrTargetInput.placeholder = printed;
  const encodes = design.metrics.qrTarget;
  qrEncodes.textContent = encodes && encodes !== printed ? `Scans open ${encodes}` : '';

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

const repaint = debounce(() => {
  paint();
  refreshQueryEditor();
}, 140);

/* --- inputs --------------------------------------------------------------- */

/** The plain text inputs. The query's parts are bound separately, by the editor. */
const FIELDS: SharedKey[] = [
  'name', 'title', 'url', 'qrTarget', 'headline', 'updated',
  'chestSubject', 'chestValue', 'ecc',
];

for (const key of FIELDS) {
  const el = document.querySelector<HTMLInputElement | HTMLSelectElement>(`#f-${key}`);
  if (!el) continue;

  // Only a value that came from a shared link pre-fills the box; everything
  // else shows as a placeholder the person types straight over.
  const initial = state[key] as string | undefined;
  if (initial) el.value = initial;
  if (el instanceof HTMLInputElement) el.placeholder = String(DEFAULTS[key] ?? '');

  el.addEventListener('input', () => {
    setField(key, el.value);
    repaint();
  });
}

/** Typed writes, so an empty query override falls back to the derived value. */
function setField(key: SharedKey, value: string): void {
  switch (key) {
    case 'ecc':
      state.ecc = (value || DEFAULTS.ecc) as ShirtInput['ecc'];
      return;
    case 'selectColumn':
    case 'table':
    case 'field':
    case 'value':
    case 'andField':
    case 'andValue':
      // Blank falls back to the derived or default part, shown as placeholder.
      state[key] = value || undefined;
      return;
    case 'qrTarget':
    case 'sortBy':
      state[key] = value;
      return;
    default:
      state[key] = value;
  }
}

/* --- the query, edited as the query ---------------------------------------- */

const queryInputs = new Map<(typeof QUERY_KEYS)[number], HTMLInputElement>();

for (const key of QUERY_KEYS) {
  const el = document.querySelector<HTMLInputElement>(`.q-in[data-q="${key}"]`);
  if (!el) continue;
  queryInputs.set(key, el);

  const initial = state[key];
  if (initial) el.value = initial;

  el.addEventListener('input', () => {
    setField(key, el.value);
    sizeToContent(el);
    repaint();
  });
}

/**
 * Monospace makes the width of a field exactly the width of its contents.
 * The extra half-character is room for the caret at the end of the word.
 */
function sizeToContent(el: HTMLInputElement): void {
  const chars = Math.max((el.value || el.placeholder).length, 1);
  el.style.width = `${chars + 0.5}ch`;
}

/**
 * Show what each blank field would print, as its placeholder.
 *
 * The derived parts change whenever the job title does, so a field left blank
 * has to keep saying what it is currently standing in for.
 */
function refreshQueryEditor(): void {
  if (!design) return;
  const printed = design.query;
  const from = printed[0]?.match(/^SELECT (\S+) FROM (.+)$/);
  const where = printed[1]?.match(/^WHERE (\S+) = '(.*)'$/);
  const and = printed[2]?.match(/^ {2}AND (\S+) = (.*?);?$/);

  const show = (key: (typeof QUERY_KEYS)[number], value: string | undefined) => {
    const el = queryInputs.get(key);
    if (!el || value === undefined) return;
    el.placeholder = value;
    sizeToContent(el);
  };

  show('selectColumn', from?.[1]);
  show('table', from?.[2]);
  show('field', where?.[1]);
  show('value', where?.[2]);
  show('andField', and?.[1]);
  show('andValue', and?.[2]);
  show('sortBy', state.sortBy || DEFAULT_SORT_COLUMN);

  const sorted = Boolean(state.sortBy);
  sortLine.hidden = !sorted;
  // The statement ends on whichever line is last, so the semicolon moves.
  semiAnd.hidden = sorted;
}

sortToggle.checked = Boolean(state.sortBy);
sortToggle.addEventListener('change', () => {
  const column = queryInputs.get('sortBy')?.value.trim();
  state.sortBy = sortToggle.checked ? column || DEFAULT_SORT_COLUMN : '';
  const el = queryInputs.get('sortBy');
  if (el && sortToggle.checked && !el.value) el.value = '';
  paint();
  refreshQueryEditor();
});

/* --- ink shelf ------------------------------------------------------------ */

const accentRow = $('#accents');
accentRow.innerHTML = ACCENTS.map(
  (ink) =>
    `<button type="button" class="swatch" style="--swatch:${ink.hex}" ` +
    `data-hex="${ink.hex}" role="radio" aria-checked="false" ` +
    `aria-label="${escape(ink.name)}" title="${escape(ink.name)}"></button>`,
).join('');

function describeInk(ink: Ink): string {
  const cmyk = ink.cmyk.map((v) => Math.round(v * 100)).join('/');
  const base = ink.pantone
    ? `${ink.name} — ${ink.hex}, Pantone ${ink.pantone}, CMYK ${cmyk}`
    : `${ink.name} — ${ink.hex}, CMYK ${cmyk}`;
  // A dark ink on a dark shirt disappears on fabric long before it does on screen.
  return contrastOnGarment(ink.hex, garment) < 3
    ? `${base}. This is dark for a black shirt — it will be hard to read.`
    : base;
}

/** Reflect the current ink across the shelf, the picker and the hex field. */
function showInk(): void {
  for (const el of accentRow.querySelectorAll<HTMLElement>('.swatch')) {
    const on = el.dataset.hex === state.accent.hex;
    el.classList.toggle('is-on', on);
    el.setAttribute('aria-checked', String(on));
  }
  colorInput.value = state.accent.hex;
  if (hexInput.value.toUpperCase() !== state.accent.hex) hexInput.value = state.accent.hex;
  inkNote.textContent = describeInk(state.accent);
}

function setAccent(value: string): void {
  const ink = inkFromHex(value);
  if (!ink) return;
  // A hex that matches a preset keeps the preset's measured CMYK and Pantone.
  state.accent = ACCENTS.find((a) => a.hex === ink.hex) ?? ink;
  showInk();
  paint();
}

accentRow.addEventListener('click', (event) => {
  const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('.swatch');
  if (btn?.dataset.hex) setAccent(btn.dataset.hex);
});

colorInput.addEventListener('input', () => setAccent(colorInput.value));
hexInput.addEventListener('input', () => {
  if (inkFromHex(hexInput.value)) setAccent(hexInput.value);
});
hexInput.addEventListener('blur', () => showInk());

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
    showInk();
    paint();
    refreshQueryEditor();
  } catch {
    cloth.dataset.loading = 'false';
    alerts.innerHTML =
      '<p class="alert">The fonts did not load, so nothing can be outlined. Check your connection and reload.</p>';
  }
})();
