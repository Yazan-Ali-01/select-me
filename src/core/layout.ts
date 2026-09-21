import { BACK, FRONT, MIN_TYPE_MM, WHITE } from './spec.js';
import { ascenderEm, inkBox, runToPath, type FontSet } from './fonts.js';
import { buildQuery, lineText, resolveQuery, type Segment } from './query.js';
import { buildQrTile } from './qr.js';
import { displayUrl, fitSize, fitToBand, qrUrl, tidy, unsupportedChars } from './text.js';
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
  // Each is also held inside the band above its own baseline, so a short title
  // grows to fill the measure without climbing off the top of the artwork.
  const kickerTop = inkBox(fonts[500], kicker)?.y1 ?? 0.72;
  const kickerSize = Math.min(
    fitSize(kicker.length, BACK.widthMm),
    fitToBand(kickerTop, BACK.kickerBaseline, 0),
  );

  const headlineTop = inkBox(fonts[600], headline)?.y1 ?? 0.72;
  const headlineSize = Math.min(
    fitSize(headline.length, BACK.widthMm),
    // A quarter of its own size of clear air below the kicker's baseline.
    fitToBand(headlineTop, BACK.headlineBaseline, BACK.kickerBaseline, 0.25),
  );

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

  // One size for every query line — a code block with mixed sizes is not a
  // code block — set from the longest line against the type column.
  const query = buildQuery(resolveQuery(input, input.title));
  const longest = Math.max(...query.map((l) => lineText(l).length));
  const codeBox = inkBox(fonts[500], query.map(lineText).join(''));
  const codeSize = Math.min(
    fitSize(longest, col),
    // Never taller than the leading, or the lines grow into each other.
    fitToBand((codeBox?.y1 ?? 0.76) - (codeBox?.y0 ?? -0.14), BACK.codeLeading, 0),
  );

  query.forEach((line, i) => {
    shapes.push(
      ...segmentPaths(fonts, 500, line, {
        sizeMm: codeSize,
        penXMm: 0,
        baselineMm: BACK.codeBaseline + i * BACK.codeLeading,
      }),
    );
  });

  // The rule and the name follow the query down; the link and comment do not.
  const lastCodeBaseline = BACK.codeBaseline + (query.length - 1) * BACK.codeLeading;
  const ruleY = lastCodeBaseline + BACK.ruleGap;
  const nameBaseline = ruleY + BACK.nameGap;

  shapes.push({ kind: 'rect', x: 0, y: ruleY, w: col, h: BACK.rule.heightMm, ink: 'white' });

  // Fixed sizes that only ever shrink, so short names stay bold and long ones still fit.
  const nameSize = fitSize(name.length, col, BACK.nameSizeMm);
  const urlSize = fitSize(url.length, col, BACK.urlSizeMm);
  const commentSize = fitSize(comment.length, col, BACK.commentSizeMm);

  shapes.push(
    ...segmentPaths(fonts, 600, plain(name), {
      sizeMm: nameSize,
      penXMm: 0,
      baselineMm: nameBaseline,
    }),
  );

  const target = qrUrl(tidy(input.qrTarget || '') || input.url);
  const tile = buildQrTile(target, {
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
    qrTarget: target,
  });

  return { widthMm: BACK.widthMm, heightMm: BACK.heightMm, shapes };
}

export function layoutFront(input: ShirtInput, fonts: FontSet, metrics: Partial<Metrics>): Drawing {
  const subject = tidy(input.chestSubject) || 'available';
  const value = tidy(input.chestValue) || 'true';
  const line = `${subject} = ${value}`;

  const box = inkBox(fonts[500], line);
  const top = box?.y1 ?? 0.76;
  const bottom = -(box?.y0 ?? 0);
  const half = ascenderEm(fonts[500]) / 2;

  // Centre the ascender band on the dot's axis, so the dot reads as a bullet
  // rather than as punctuation that drifted. Centring fixes the baseline, so
  // the size is then held to whatever keeps the ink inside the print area.
  const margin = 1;
  const sizeMm = Math.min(
    fitSize(line.length, FRONT.widthMm - FRONT.textX),
    // Ink top:    dot.cy + half*s - top*s    >= margin
    (FRONT.dot.cy - margin) / Math.max(top - half, 1e-6),
    // Ink bottom: dot.cy + half*s + bottom*s <= height - margin
    (FRONT.heightMm - margin - FRONT.dot.cy) / Math.max(half + bottom, 1e-6),
  );
  const baselineMm = FRONT.dot.cy + half * sizeMm;
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

  const parts = resolveQuery(input, input.title);
  const bad = unsupportedChars(
    [
      input.name, input.title, input.url, input.headline, input.updated,
      input.chestSubject, input.chestValue,
      parts.selectColumn, parts.table, parts.field, parts.value,
      parts.andField, parts.andValue, parts.sortBy,
    ].join(' '),
  );
  if (bad.length) {
    warnings.push(
      `IBM Plex Mono's Latin subset has no glyph for ${bad.map((c) => `"${c}"`).join(', ')}, so ${bad.length > 1 ? 'those characters' : 'that character'} will not print. Use a Latin spelling.`,
    );
  }

  const metrics: Partial<Metrics> = { inks: input.accent.hex === WHITE.hex ? 1 : 2 };
  const back = layoutBack(input, fonts, warnings, metrics);
  const front = layoutFront(input, fonts, metrics);

  return {
    front,
    back,
    palette: { accent: input.accent, white: WHITE },
    query: buildQuery(parts).map(lineText),
    metrics: metrics as Metrics,
    warnings,
    input,
  };
}
