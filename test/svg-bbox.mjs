/** Minimal SVG reader used only by the tests, so a measurement bug cannot hide behind the renderer. */

function cubicExtremes(p0, p1, p2, p3) {
  const out = [p0, p3];
  const a = 3 * (-p0 + 3 * p1 - 3 * p2 + p3);
  const b = 6 * (p0 - 2 * p1 + p2);
  const c = 3 * (p1 - p0);
  let roots = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) roots = [-c / b];
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const r = Math.sqrt(disc);
      roots = [(-b + r) / (2 * a), (-b - r) / (2 * a)];
    }
  }
  for (const t of roots) {
    if (t <= 0 || t >= 1) continue;
    const m = 1 - t;
    out.push(m * m * m * p0 + 3 * m * m * t * p1 + 3 * m * t * t * p2 + t * t * t * p3);
  }
  return out;
}

export function pathBBox(d) {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || [];
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (px, py) => {
    if (px < x0) x0 = px;
    if (px > x1) x1 = px;
    if (py < y0) y0 = py;
    if (py > y1) y1 = py;
  };
  const n = () => Number.parseFloat(tokens[i++]);

  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const dx = rel ? x : 0;
    const dy = rel ? y : 0;

    if (C === 'M') { x = sx = n() + dx; y = sy = n() + dy; add(x, y); cmd = rel ? 'l' : 'L'; }
    else if (C === 'L') { x = n() + dx; y = n() + dy; add(x, y); }
    else if (C === 'H') { x = n() + dx; add(x, y); }
    else if (C === 'V') { y = n() + dy; add(x, y); }
    else if (C === 'C') {
      const a = n() + dx, b = n() + dy, c = n() + dx, e = n() + dy, f = n() + dx, g = n() + dy;
      for (const v of cubicExtremes(x, a, c, f)) add(v, y);
      for (const v of cubicExtremes(y, b, e, g)) add(x, v);
      add(f, g); x = f; y = g;
    } else if (C === 'Q') {
      const a = n() + dx, b = n() + dy, f = n() + dx, g = n() + dy;
      for (const v of cubicExtremes(x, x + (2 / 3) * (a - x), f + (2 / 3) * (a - f), f)) add(v, y);
      for (const v of cubicExtremes(y, y + (2 / 3) * (b - y), g + (2 / 3) * (b - g), g)) add(x, v);
      add(f, g); x = f; y = g;
    } else if (C === 'Z') { x = sx; y = sy; }
    else n();
  }
  return { x0, y0, x1, y1 };
}

/** Every drawable in an SVG, in document order, reduced to a bounding box. */
export function svgElements(svg) {
  const body = svg.replace(/<metadata>[\s\S]*?<\/metadata>/, '').replace(/<style>[\s\S]*?<\/style>/, '');
  const out = [];
  for (const m of body.matchAll(/<(path|rect|circle)([^>]*?)\/>/g)) {
    const [, tag, attrs] = m;
    const attr = (k) => (attrs.match(new RegExp(`${k}="([^"]+)"`)) || [])[1];
    const num = (k) => Number.parseFloat(attr(k) ?? '0');
    const fill = attr('fill');

    if (tag === 'path') out.push({ fill, evenOdd: attrs.includes('evenodd'), ...pathBBox(attr('d')) });
    else if (tag === 'rect') out.push({ fill, x0: num('x'), y0: num('y'), x1: num('x') + num('width'), y1: num('y') + num('height') });
    else out.push({ fill, x0: num('cx') - num('r'), y0: num('cy') - num('r'), x1: num('cx') + num('r'), y1: num('cy') + num('r') });
  }
  return out;
}
