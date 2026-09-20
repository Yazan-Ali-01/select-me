import type { Ink } from './spec.js';

/** What the person actually types. Everything else is derived from this. */
export interface ShirtInput {
  /** Printed under the rule, at 14 mm. */
  name: string;
  /** Sets the kicker, and seeds the query unless the query fields are overridden. */
  title: string;
  /** Printed at 13 mm and encoded into the QR tile. */
  url: string;

  /** The big amber line. */
  headline: string;
  /** Trailing comment. A date, "today", or anything short. */
  updated: string;

  /** The chest line reads `{subject} = {value}`. */
  chestSubject: string;
  chestValue: string;

  /** Query overrides. Left undefined, each is derived from `title`. */
  table?: string;
  field?: string;
  value?: string;

  accent: Ink;
  /** Error correction for the QR. Q is the default: it survives fabric. */
  ecc: 'L' | 'M' | 'Q' | 'H';
}

/**
 * A resolved design: two inks, absolute millimetres, no text left to lay out.
 * Every renderer takes this and nothing else, which is why SVG, PDF and PNG
 * cannot drift apart.
 */
export interface Drawing {
  widthMm: number;
  heightMm: number;
  shapes: Shape[];
}

export type Shape =
  | { kind: 'path'; d: string; ink: InkRole; evenOdd?: boolean }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; ink: InkRole }
  | { kind: 'circle'; cx: number; cy: number; r: number; ink: InkRole };

/** Shapes name an ink by role; the palette resolves it. Two screens, always. */
export type InkRole = 'accent' | 'white';

/** Production numbers, resolved by the layout. */
export interface Metrics {
  /** Type size of each auto-fitted line, in mm. */
  titleMm: number;
  headlineMm: number;
  queryMm: number;
  nameMm: number;
  urlMm: number;
  chestMm: number;
  qrModules: number;
  qrModuleMm: number;
  /** Screens per placement. One, if the accent is white. */
  inks: 1 | 2;
}

export interface Palette {
  accent: Ink;
  white: Ink;
}

/** Both placements, plus everything the spec sheet needs to describe them. */
export interface ShirtDesign {
  front: Drawing;
  back: Drawing;
  palette: Palette;
  /** The rendered query, for display in the UI and the spec sheet. */
  query: string[];
  /** What the layout decided. Shown live, because watching it change is the point. */
  metrics: Metrics;
  /** Anything the layout had to do to make the input fit. */
  warnings: string[];
  input: ShirtInput;
}
