import type { InkRole } from './types.js';
import { tidy } from './text.js';

/** One coloured stretch of a code line. */
export interface Segment {
  text: string;
  ink: InkRole;
}

/**
 * Every part of the printed query. Nothing in the statement is hard-coded —
 * a shirt that can only ever say `available = true` is a poster, not a tool.
 */
export interface QueryParts {
  selectColumn: string;
  table: string;
  field: string;
  value: string;
  andField: string;
  andValue: string;
  /** Empty means no `ORDER BY` line, and the statement ends a line earlier. */
  sortBy: string;
}

/** The parts that do not depend on the job title. */
export const QUERY_DEFAULTS = {
  selectColumn: 'name',
  andField: 'available',
  andValue: 'true',
  sortBy: '',
} as const;

/** Seniority words that read naturally as `level = '...'`. */
const LEVELS = new Set([
  'intern', 'graduate', 'grad', 'entry', 'junior', 'jr', 'associate', 'mid',
  'intermediate', 'senior', 'sr', 'staff', 'principal', 'lead', 'head', 'chief',
  'distinguished', 'fellow', 'director', 'vp',
]);

/**
 * Abstract nouns that end a job title but make a terrible table name.
 * "VP of Engineering" should select from `engineers`, not `engineerings`.
 */
const AGENT_NOUNS: Record<string, string> = {
  engineering: 'engineers',
  design: 'designers',
  marketing: 'marketers',
  research: 'researchers',
  operations: 'operators',
  ops: 'ops',
  devops: 'engineers',
  sre: 'sres',
  qa: 'testers',
  security: 'engineers',
  infrastructure: 'engineers',
  data: 'engineers',
  product: 'managers',
  science: 'scientists',
  analytics: 'analysts',
  sales: 'reps',
  support: 'agents',
  finance: 'analysts',
  legal: 'counsel',
  people: 'partners',
  recruiting: 'recruiters',
};

const PLURAL_EXCEPTIONS: Record<string, string> = {
  person: 'people',
  woman: 'women',
  man: 'men',
  analysis: 'analyses',
  counsel: 'counsel',
};

function pluralize(word: string): string {
  const w = word.toLowerCase();
  if (PLURAL_EXCEPTIONS[w]) return PLURAL_EXCEPTIONS[w]!;
  if (AGENT_NOUNS[w]) return AGENT_NOUNS[w]!;
  if (/s$/.test(w)) return w;
  if (/(x|z|ch|sh)$/.test(w)) return `${w}es`;
  if (/[^aeiou]y$/.test(w)) return `${w.slice(0, -1)}ies`;
  return `${w}s`;
}

/** A word that already names a person is the best table name available. */
function looksLikeAgentNoun(word: string): boolean {
  return /(er|or|ist|eer|ian|ant|ect|dev|smith|lead|head|chief)$/.test(word);
}

export interface DerivedQuery {
  table: string;
  field: string;
  value: string;
}

/**
 * Turn a job title into the three query parts it can actually imply.
 *
 * "Senior Software Engineer" -> engineers / level / senior. The heuristic is
 * good, not clairvoyant, which is why every part stays editable.
 */
export function deriveQuery(title: string): DerivedQuery {
  const words = tidy(title)
    .toLowerCase()
    .replace(/[^a-z0-9\s/&+-]/g, '')
    .split(/[\s/&+]+/)
    .filter(Boolean)
    .filter((w) => w !== 'of' && w !== 'the');

  if (words.length === 0) return { table: 'engineers', field: 'level', value: 'senior' };

  const first = words[0]!;
  const hasLevel = LEVELS.has(first) && words.length > 1;
  const level = hasLevel ? first : '';
  const rest = hasLevel ? words.slice(1) : words;

  // Prefer an explicit agent noun; fall back to the last word of the title.
  const agent = [...rest].reverse().find((w) => AGENT_NOUNS[w] || looksLikeAgentNoun(w));
  const table = pluralize(agent ?? rest[rest.length - 1] ?? 'engineer');

  return hasLevel
    ? { table, field: 'level', value: level }
    : { table, field: 'role', value: rest.join(' ') };
}

/** Fill in whatever the caller left out, from the title and the defaults. */
export function resolveQuery(
  overrides: Partial<QueryParts>,
  title: string,
): QueryParts {
  const derived = deriveQuery(title);
  const pick = (given: string | undefined, fallback: string) => {
    const clean = tidy(given ?? '');
    return clean || fallback;
  };
  return {
    selectColumn: pick(overrides.selectColumn, QUERY_DEFAULTS.selectColumn),
    table: pick(overrides.table, derived.table),
    field: pick(overrides.field, derived.field),
    value: pick(overrides.value, derived.value),
    andField: pick(overrides.andField, QUERY_DEFAULTS.andField),
    andValue: pick(overrides.andValue, QUERY_DEFAULTS.andValue),
    // The sort line is off unless asked for, so an empty string stays empty.
    sortBy: tidy(overrides.sortBy ?? ''),
  };
}

/**
 * Build the printed lines.
 *
 * Literals are accent, everything else is white — and that split is the entire
 * syntax highlighter, because two inks is all a screen printer gets.
 *
 * The statement's semicolon lives on whichever line ends it, so switching the
 * sort line on does not leave the query terminated in the middle.
 */
export function buildQuery(q: QueryParts): Segment[][] {
  const sorted = q.sortBy !== '';

  const lines: Segment[][] = [
    [{ text: `SELECT ${q.selectColumn} FROM ${q.table}`, ink: 'white' }],
    [
      { text: `WHERE ${q.field} = `, ink: 'white' },
      { text: `'${q.value}'`, ink: 'accent' },
    ],
    [
      { text: `  AND ${q.andField} = `, ink: 'white' },
      { text: q.andValue, ink: 'accent' },
      ...(sorted ? [] : [{ text: ';', ink: 'white' as InkRole }]),
    ],
  ];

  if (sorted) {
    lines.push([
      { text: `ORDER BY ${q.sortBy} DESC LIMIT `, ink: 'white' },
      { text: '1', ink: 'accent' },
      { text: ';', ink: 'white' },
    ]);
  }
  return lines;
}

export const lineText = (segs: Segment[]): string => segs.map((s) => s.text).join('');
