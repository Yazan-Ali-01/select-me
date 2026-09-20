import { PT_PER_MM } from './spec.js';

/**
 * A very small PDF writer.
 *
 * It exists because the alternative was a 300 kB dependency to emit filled
 * vector paths, and because a print PDF needs two things most libraries make
 * awkward: real CMYK fills, and a page box that is exactly the artwork size
 * with no margin invented anywhere.
 */

export type Cmyk = [number, number, number, number];

export interface PdfShape {
  /** SVG path data, in millimetres, y-down. */
  d: string;
  cmyk: Cmyk;
  evenOdd?: boolean;
  /** Optional [a b c d e f] matrix, applied to this shape alone. */
  transform?: [number, number, number, number, number, number];
}

export interface PdfPage {
  widthMm: number;
  heightMm: number;
  shapes: PdfShape[];
}

export interface PdfMeta {
  title?: string;
  author?: string;
  subject?: string;
  creator?: string;
}

// --- path translation -------------------------------------------------------

const f = (v: number) => {
  const s = v.toFixed(4);
  return s.replace(/\.?0+$/, '') || '0';
};

/**
 * Translate SVG path data into PDF path operators.
 *
 * Coordinates pass through untouched: the page-level transform already maps
 * millimetres with y pointing down onto PDF's points with y pointing up, so
 * there is no per-point arithmetic here to get subtly wrong.
 */
export function pathToPdfOps(d: string): string {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g);
  if (!tokens) return '';

  const out: string[] = [];
  let i = 0;
  let cmd = '';
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  // Reflection points for the smooth curve commands.
  let lastC: [number, number] | null = null;
  let lastQ: [number, number] | null = null;

  const num = () => Number(tokens[i++]);
  const moveTo = (nx: number, ny: number) => {
    out.push(`${f(nx)} ${f(ny)} m`);
    x = startX = nx;
    y = startY = ny;
  };
  const lineTo = (nx: number, ny: number) => {
    out.push(`${f(nx)} ${f(ny)} l`);
    x = nx;
    y = ny;
  };
  const curveTo = (x1: number, y1: number, x2: number, y2: number, nx: number, ny: number) => {
    out.push(`${f(x1)} ${f(y1)} ${f(x2)} ${f(y2)} ${f(nx)} ${f(ny)} c`);
    lastC = [x2, y2];
    x = nx;
    y = ny;
  };
  /** PDF has no quadratic operator, so raise the degree. */
  const quadTo = (qx: number, qy: number, nx: number, ny: number) => {
    curveTo(x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), nx + (2 / 3) * (qx - nx), ny + (2 / 3) * (qy - ny), nx, ny);
    lastQ = [qx, qy];
  };

  while (i < tokens.length) {
    const tok = tokens[i]!;
    if (/[A-Za-z]/.test(tok)) {
      cmd = tok;
      i++;
    }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const dx = rel ? x : 0;
    const dy = rel ? y : 0;

    switch (C) {
      case 'M': {
        moveTo(num() + dx, num() + dy);
        // Subsequent coordinate pairs after a moveto are implicit linetos.
        cmd = rel ? 'l' : 'L';
        lastC = lastQ = null;
        break;
      }
      case 'L':
        lineTo(num() + dx, num() + dy);
        lastC = lastQ = null;
        break;
      case 'H':
        lineTo(num() + dx, y);
        lastC = lastQ = null;
        break;
      case 'V':
        lineTo(x, num() + dy);
        lastC = lastQ = null;
        break;
      case 'C': {
        const x1 = num() + dx, y1 = num() + dy, x2 = num() + dx, y2 = num() + dy;
        curveTo(x1, y1, x2, y2, num() + dx, num() + dy);
        lastQ = null;
        break;
      }
      case 'S': {
        const [rx, ry] = lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y];
        const x2 = num() + dx, y2 = num() + dy;
        curveTo(rx, ry, x2, y2, num() + dx, num() + dy);
        lastQ = null;
        break;
      }
      case 'Q': {
        const qx = num() + dx, qy = num() + dy;
        quadTo(qx, qy, num() + dx, num() + dy);
        break;
      }
      case 'T': {
        const [rx, ry] = lastQ ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y];
        quadTo(rx, ry, num() + dx, num() + dy);
        break;
      }
      case 'Z':
        out.push('h');
        x = startX;
        y = startY;
        lastC = lastQ = null;
        break;
      default:
        i++; // Unknown operator: drop its operand rather than spin.
    }
  }
  return out.join('\n');
}

function pageContent(page: PdfPage): string {
  const k = PT_PER_MM;
  // Map millimetres, y-down, onto points, y-up. Everything after this is in mm.
  const lines = [`${f(k)} 0 0 ${f(-k)} 0 ${f(page.heightMm * k)} cm`];

  for (const shape of page.shapes) {
    const ops = pathToPdfOps(shape.d);
    if (!ops) continue;
    const [c, m, yy, kk] = shape.cmyk;
    if (shape.transform) lines.push('q', `${shape.transform.map(f).join(' ')} cm`);
    lines.push(`${f(c)} ${f(m)} ${f(yy)} ${f(kk)} k`, ops, shape.evenOdd ? 'f*' : 'f');
    if (shape.transform) lines.push('Q');
  }
  return lines.join('\n');
}

// --- object assembly --------------------------------------------------------

const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** PDF strings are bytes; parentheses and backslashes have to be escaped. */
const pdfString = (s: string) =>
  `(${s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, '')})`;

function pdfDate(d: Date): string {
  const p = (v: number) => String(v).padStart(2, '0');
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** zlib deflate, where the platform offers it. Falls back to storing the stream raw. */
async function deflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  const CS = (globalThis as { CompressionStream?: typeof CompressionStream }).CompressionStream;
  if (!CS) return null;
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CS('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

export async function buildPdf(pages: PdfPage[], meta: PdfMeta = {}): Promise<Uint8Array> {
  const objects: Uint8Array[] = [];
  /** Reserve an object number; PDF numbering is 1-based. */
  const add = (body: Uint8Array | string) => {
    objects.push(typeof body === 'string' ? latin1(body) : body);
    return objects.length;
  };

  // 1: catalog, 2: page tree. Both are patched once the page objects exist.
  const catalogId = add('');
  const pagesId = add('');
  const pageIds: number[] = [];

  for (const page of pages) {
    const raw = latin1(pageContent(page));
    const packed = await deflate(raw);
    const stream = packed ?? raw;
    const dict =
      `<< /Length ${stream.length}${packed ? ' /Filter /FlateDecode' : ''} >>\nstream\n`;
    const contentId = add(concat([latin1(dict), stream, latin1('\nendstream')]));

    const w = f(page.widthMm * PT_PER_MM);
    const h = f(page.heightMm * PT_PER_MM);
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${w} ${h}] ` +
          `/TrimBox [0 0 ${w} ${h}] /Resources << /ProcSet [/PDF] >> /Contents ${contentId} 0 R >>`,
      ),
    );
  }

  objects[catalogId - 1] = latin1(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  objects[pagesId - 1] = latin1(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`,
  );

  const infoId = add(
    `<< /Title ${pdfString(meta.title ?? 'Shirt artwork')} ` +
      `/Author ${pdfString(meta.author ?? '')} ` +
      `/Subject ${pdfString(meta.subject ?? '')} ` +
      `/Creator ${pdfString(meta.creator ?? 'select-me')} ` +
      `/Producer ${pdfString('select-me')} ` +
      `/CreationDate ${pdfString(pdfDate(new Date()))} >>`,
  );

  const chunks: Uint8Array[] = [latin1('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n')];
  let offset = chunks[0]!.length;
  const offsets: number[] = [];

  objects.forEach((body, index) => {
    offsets.push(offset);
    const head = latin1(`${index + 1} 0 obj\n`);
    const tail = latin1('\nendobj\n');
    chunks.push(head, body, tail);
    offset += head.length + body.length + tail.length;
  });

  const xrefAt = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) xref += `${String(at).padStart(10, '0')} 00000 n \n`;
  xref +=
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\n` +
    `startxref\n${xrefAt}\n%%EOF\n`;
  chunks.push(latin1(xref));

  return concat(chunks);
}
