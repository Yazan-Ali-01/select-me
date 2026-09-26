/**
 * The print specification, in millimetres.
 *
 * Every number here was measured off the original artwork rather than invented,
 * so a design generated from these constants is dimensionally identical to the
 * shirt that started this project. Nothing downstream hard-codes a size: the
 * renderers all read from here.
 */

/** Two inks. That is the whole palette, and it is a printing constraint, not an aesthetic one. */
export interface Ink {
  /** sRGB hex, for screen and for the PNG/SVG deliverables. */
  hex: string;
  /** Coated-stock CMYK, for the PDF. Print shops ask for this. */
  cmyk: [number, number, number, number];
  /** Nearest Pantone, quoted in the spec sheet for screen printers mixing ink. */
  pantone?: string;
  name: string;
}

export const WHITE: Ink = {
  hex: '#FFFFFF',
  cmyk: [0, 0, 0, 0],
  name: 'White',
};

/** The default accent, taken from the original shirt. */
export const AMBER: Ink = {
  hex: '#FFAE3D',
  cmyk: [0, 0.36, 0.79, 0],
  pantone: '143 C',
  name: 'Amber',
};

/**
 * Alternate accents. Each one is a real ink a shop can hit on a dark garment;
 * the CMYK values are the honest conversion, not a guess wrapped in confidence.
 */
export const ACCENTS: Ink[] = [
  AMBER,
  { hex: '#4FC3F7', cmyk: [0.63, 0.1, 0, 0], pantone: '298 C', name: 'Cyan' },
  { hex: '#7BE495', cmyk: [0.5, 0, 0.5, 0], pantone: '344 C', name: 'Mint' },
  { hex: '#FF6B6B', cmyk: [0, 0.65, 0.55, 0], pantone: '178 C', name: 'Coral' },
  { hex: '#C9A6FF', cmyk: [0.28, 0.4, 0, 0], pantone: '2635 C', name: 'Lilac' },
  { hex: '#FFFFFF', cmyk: [0, 0, 0, 0], name: 'White only' },
];

/** IBM Plex Mono, the only family used. Weights are the three the design needs. */
export type Weight = 400 | 500 | 600;

export const FONT_FILES: Record<Weight, string> = {
  400: 'IBMPlexMono-Regular.ttf',
  500: 'IBMPlexMono-Medium.ttf',
  600: 'IBMPlexMono-SemiBold.ttf',
};

/** Monospace advance, in em. True for every glyph in the family. */
export const ADVANCE_EM = 0.6;

/**
 * Type is set to 99% of its column, never 100%.
 *
 * The 1% is the reason the last glyph never kisses the trim edge, and it is the
 * single rule behind every auto-sized line in the layout. Measured off the
 * original: the kicker, the code block and the chest line all land on it exactly.
 */
export const FIT_RATIO = 0.99;

/**
 * Stand-ins used while a field is still empty, so the preview always looks like
 * a finished shirt rather than one with holes in it.
 */
export const PLACEHOLDER = {
  name: 'Your Name',
  title: 'Senior Software Engineer',
  url: 'yoursite.com',
} as const;

/** Below this the print is a smudge, so the layout refuses to go further. */
export const MIN_TYPE_MM = 3;

// ---------------------------------------------------------------------------
// Back print — 270 x 182 mm, centred, top edge 82 mm below the collar seam.
// ---------------------------------------------------------------------------

export const BACK = {
  widthMm: 270,
  heightMm: 182,

  /** The type column. Everything except the QR tile lives inside it. */
  columnMm: 171.6,

  /** Baselines, top down. Round numbers, and they are load-bearing. */
  kickerBaseline: 14,
  headlineBaseline: 50,
  codeBaseline: 78,
  /** Leading between the lines of the query. */
  codeLeading: 14,

  /**
   * The rule and the name hang off the *last* line of the query rather than
   * sitting at fixed heights, so turning the sort line on pushes them down by
   * exactly one line instead of colliding with it. The link and the comment
   * stay anchored to the bottom edge, and the name floats in between.
   *
   * With three query lines these gaps reproduce the original exactly:
   * 106 + 7 = 113 for the rule, 113 + 18 = 131 for the name.
   */
  ruleGap: 7,
  rule: { heightMm: 1.1 },

  nameGap: 18,
  nameSizeMm: 14,

  urlBaseline: 160,
  urlSizeMm: 13,

  commentBaseline: 175,
  commentSizeMm: 8,

  /**
   * The QR tile is flush to the right trim and 76 mm square.
   * The spec sheet forbids shrinking it: below 76 mm the knockout modules start
   * closing up on fabric.
   */
  qr: { x: 194, y: 64, sizeMm: 76, quietModules: 4 },
} as const;

// ---------------------------------------------------------------------------
// Front chest — 100 x 20 mm, left chest, deliberately off-centre.
// ---------------------------------------------------------------------------

export const FRONT = {
  widthMm: 100,
  heightMm: 20,
  dot: { cx: 4.5, cy: 8.6, r: 3 },
  /** Pen origin for the line, leaving a 3.5 mm gap after the dot. */
  textX: 11,
} as const;

/** Placement instructions the print shop needs and the artwork cannot carry. */
export const PLACEMENT = {
  front: {
    label: 'FRONT — left chest',
    belowCollarMm: 65,
    leftOfCentreMm: 60,
  },
  back: {
    label: 'BACK — centred',
    belowCollarMm: 82,
  },
  garment: 'Solid black or solid charcoal. Not heather — the flecks reduce contrast.',
} as const;

/** 300 DPI is what every shop asks for and what the PNG deliverable is rendered at. */
export const PRINT_DPI = 300;

export const MM_PER_INCH = 25.4;
export const PT_PER_MM = 72 / MM_PER_INCH;
