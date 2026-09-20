import { BACK, FRONT, MIN_TYPE_MM, WHITE } from './spec.js';
import { ascenderEm, runToPath, type FontSet } from './fonts.js';
import { buildQuery, deriveQuery, lineText, type Segment } from './query.js';
import { buildQrTile } from './qr.js';
import { displayUrl, fitSize, qrUrl, tidy, unsupportedChars } from './text.js';
import type { Drawing, InkRole, Metrics, Shape, ShirtDesign, ShirtInput } from './types.js';

/**
 * Lay a line of coloured segments onto the shared monospace grid.
 *
 * Runs are laid out against the whole line's character positions, not their own,
 * which is what keeps `'senior'` sitting on the same grid as the `WHERE` before
 * it. Same-ink runs then collapse into one path per line, so each line costs one
 * path per ink — one object per screen, which is how a printer wants it.
 */
function segmentPaths(
  fonts: FontSet,
  weight: 400 | 500 | 600,
  segments: Segment[],
  opts: { sizeMm: number; penXMm: number; baselineMm: number },
): Shape[] {
  const full = lineText(segments);
  const byInk = new Map<InkRole, string[]>();
  let index = 0;

  for (const seg of segments) {
    const from = index;
    index += seg.text.length;
    const d = runToPath(fonts[weight], full, { from, to: index, ...opts });
    if (!d) continue;
    const existing = byInk.get(seg.ink);
    if (existing) existing.push(d);
    else byInk.set(seg.ink, [d]);
  }

  return [...byInk].map(([ink, parts]) => ({ kind: 'path', d: parts.join(' '), ink }) as Shape);
}

const plain = (text: string, ink: 'white' | 'accent' = 'white'): Segment[] => [{ text, ink }];

export function layoutBack(
  input: ShirtInput,
  fonts: FontSet,
  warnings: string[],
  metrics: Partial<Metrics>,
): Drawing {
  const shapes: Shape[] = [];
  const col = BACK.columnMm;

  const kicker = tidy(input.title).toUpperCase();
  const headline = tidy(input.headline).toUpperCase();
  const name = tidy(input.name);
  const url = displayUrl(input.url);
  const comment = `-- last updated: ${tidy(input.updated)}`;

  // Display lines fill the full trim width; the rest live in the type column.
  const kickerSize = fitSize(kicker.length, BACK.widthMm);
  const headlineSize = fitSize(headline.length, BACK.widthMm);

  shapes.push(
    ...segmentPaths(fonts, 500, plain(kicker), {
      sizeMm: kickerSize,
      penXMm: 0,
      baselineMm: BACK.kickerBaseline,
    }),
  );
  shapes.push(
    ...segmentPaths(fonts, 600, plain(headline, 'accent'), {
      sizeMm: headlineSize,
      penXMm: 0,
      baselineMm: BACK.headlineBaseline,
    }),
  );

  // One size for all three query lines — a code block with mixed sizes is not a code block.
  const derived = deriveQuery(input.title);
  const query = buildQuery({
    table: tidy(input.table || derived.table),
    field: tidy(input.field || derived.field),
    value: tidy(input.value || derived.value),
  });
  const longest = Math.max(...query.map((l) => lineText(l).length));
  const codeSize = fitSize(longest, col);

  query.forEach((line, i) => {
    shapes.push(
      ...segmentPaths(fonts, 500, line, {
        sizeMm: codeSize,
        penXMm: 0,
        baselineMm: BACK.codeBaseline + i * BACK.codeLeading,
      }),
    );
  });

  shapes.push({ kind: 'rect', x: 0, y: BACK.rule.y, w: col, h: BACK.rule.heightMm, ink: 'white' });

  // Fixed sizes that only ever shrink, so short names stay bold and long ones still fit.
  const nameSize = fitSize(name.length, col, BACK.nameSizeMm);
  const urlSize = fitSize(url.length, col, BACK.urlSizeMm);
  const commentSize = fitSize(comment.length, col, BACK.commentSizeMm);

  shapes.push(
    ...segmentPaths(fonts, 600, plain(name), {
      sizeMm: nameSize,
      penXMm: 0,
      baselineMm: BACK.nameBaseline,
    }),
  );

  const tile = buildQrTile(qrUrl(input.url), {
    x: BACK.qr.x,
    y: BACK.qr.y,
    sizeMm: BACK.qr.sizeMm,
    quietModules: BACK.qr.quietModules,
    ecc: input.ecc,
  });
  shapes.push(tile.shape);

  shapes.push(
    ...segmentPaths(fonts, 400, plain(url), {
      sizeMm: urlSize,
      penXMm: 0,
      baselineMm: BACK.urlBaseline,
    }),
  );
  shapes.push(
    ...segmentPaths(fonts, 400, plain(comment), {
      sizeMm: commentSize,
      penXMm: 0,
      baselineMm: BACK.commentBaseline,
    }),
  );

  for (const [label, size] of [
    ['title', kickerSize],
    ['headline', headlineSize],
    ['query', codeSize],
    ['name', nameSize],
    ['url', urlSize],
  ] as const) {
    if (size < MIN_TYPE_MM) {
      warnings.push(
        `The ${label} is long enough that it sets at ${size.toFixed(1)} mm — below the ${MIN_TYPE_MM} mm floor for a clean print. Shorten it.`,
      );
    }
  }
  if (tile.moduleMm < 1.2) {
    warnings.push(
      `Your URL needs a ${tile.moduleCount}-module QR, which puts each square at ${tile.moduleMm.toFixed(2)} mm. Under 1.2 mm scanning gets unreliable on fabric — use a shorter link, or drop error correction to M.`,
    );
  }

  Object.assign(metrics, {
    titleMm: kickerSize,
    headlineMm: headlineSize,
    queryMm: codeSize,
    nameMm: nameSize,
    urlMm: urlSize,
    qrModules: tile.moduleCount,
    qrModuleMm: tile.moduleMm,
  });

  return { widthMm: BACK.widthMm, heightMm: BACK.heightMm, shapes };
}

export function layoutFront(input: ShirtInput, fonts: FontSet, metrics: Partial<Metrics>): Drawing {
  const subject = tidy(input.chestSubject) || 'available';
  const value = tidy(input.chestValue) || 'true';
  const line = `${subject} = ${value}`;

  const sizeMm = fitSize(line.length, FRONT.widthMm - FRONT.textX);
  // Centre the ascender band on the dot's axis, so the dot reads as a bullet
  // rather than as punctuation that drifted.
  const baselineMm = FRONT.dot.cy + (ascenderEm(fonts[500]) / 2) * sizeMm;
  metrics.chestMm = sizeMm;

  return {
    widthMm: FRONT.widthMm,
    heightMm: FRONT.heightMm,
    shapes: [
      { kind: 'circle', cx: FRONT.dot.cx, cy: FRONT.dot.cy, r: FRONT.dot.r, ink: 'accent' },
      ...segmentPaths(
        fonts,
        500,
        [
          { text: subject, ink: 'white' },
          { text: ' ', ink: 'white' },
          { text: `= ${value}`, ink: 'accent' },
        ],
        { sizeMm, penXMm: FRONT.textX, baselineMm },
      ),
    ],
  };
}

export function layout(input: ShirtInput, fonts: FontSet): ShirtDesign {
  const warnings: string[] = [];

  const bad = unsupportedChars(
    [input.name, input.title, input.url, input.headline, input.updated, input.chestSubject, input.chestValue]
      .join(' '),
  );
  if (bad.length) {
    warnings.push(
      `IBM Plex Mono's Latin subset has no glyph for ${bad.map((c) => `"${c}"`).join(', ')}, so ${bad.length > 1 ? 'those characters' : 'that character'} will not print. Use a Latin spelling.`,
    );
  }

  const metrics: Partial<Metrics> = { inks: input.accent.hex === WHITE.hex ? 1 : 2 };
  const back = layoutBack(input, fonts, warnings, metrics);
  const front = layoutFront(input, fonts, metrics);
  const derived = deriveQuery(input.title);
  const query = buildQuery({
    table: tidy(input.table || derived.table),
    field: tidy(input.field || derived.field),
    value: tidy(input.value || derived.value),
  }).map(lineText);

  return {
    front,
    back,
    palette: { accent: input.accent, white: WHITE },
    query,
    metrics: metrics as Metrics,
    warnings,
    input,
  };
}
