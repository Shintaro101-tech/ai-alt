// Diagrams, charts and pictures on the ALT's board.
//
// The ALT only says WHAT to show (a kind and its data); the app draws it here, so it appears at once,
// costs nothing and always looks the same. Pictures come from the lesson's picture library
// (registered by the teacher in the editor).

import { esc } from './util.js';

export const VISUAL_KINDS = ['reality', 'timeline', 'bar_chart', 'line_chart', 'table', 'venn', 'steps', 'emoji_cards'];

const COLORS = ['#1E5AA0', '#E8833A', '#1F9D61', '#8E44AD', '#C0392B', '#16A3B8'];
const arr = (x) => (Array.isArray(x) ? x : x == null || x === '' ? [] : [x]);
const str = (x) => (x == null ? '' : String(x));
const num = (x) => { const n = Number(String(x).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0; };
const item = (x) => (typeof x === 'object' && x ? { text: str(x.text ?? x.label ?? x.name), note: str(x.note ?? x.sub ?? ''), emoji: str(x.emoji ?? '') } : { text: str(x), note: '', emoji: '' });

// Cleans what the ALT sent into something we can draw. Returns null if there is nothing to draw.
export function normalizeVisual(args = {}) {
  const kind = VISUAL_KINDS.includes(args.kind) ? args.kind : null;
  if (!kind) return null;
  const v = { kind, caption: str(args.caption) };
  if (kind === 'reality') {
    v.reality = item(args.reality ?? args.items?.[0] ?? '');
    v.imagination = item(args.imagination ?? args.items?.[1] ?? '');
    v.gap = str(args.gap_label || 'distance');
    if (!v.reality.text && !v.imagination.text) return null;
  } else if (kind === 'timeline') {
    v.events = arr(args.events ?? args.items).map((e) => ({
      ...item(e),
      time: ['past', 'now', 'future'].includes(e?.time) ? e.time : 'now',
      real: e?.real !== false,
    })).filter((e) => e.text).slice(0, 8);
    if (!v.events.length) return null;
  } else if (kind === 'bar_chart' || kind === 'line_chart') {
    v.labels = arr(args.labels).map(str).slice(0, 12);
    let series = arr(args.series).map((s) => ({ name: str(s?.name), values: arr(s?.values).map(num) }));
    if (!series.length && args.values) series = [{ name: '', values: arr(args.values).map(num) }];
    v.series = series.filter((s) => s.values.length).slice(0, 4).map((s) => ({ ...s, values: s.values.slice(0, v.labels.length || 12) }));
    if (!v.labels.length) v.labels = (v.series[0]?.values || []).map((_, i) => String(i + 1));
    v.unit = str(args.unit);
    if (!v.series.length) return null;
  } else if (kind === 'table') {
    v.columns = arr(args.columns).map(str).slice(0, 6);
    v.rows = arr(args.rows).map((r) => arr(r).map(str).slice(0, 6)).filter((r) => r.length).slice(0, 10);
    if (!v.rows.length) return null;
  } else if (kind === 'venn') {
    v.left = { title: str(args.left?.title ?? args.left_title), items: arr(args.left?.items ?? args.left_items).map(str).slice(0, 5) };
    v.right = { title: str(args.right?.title ?? args.right_title), items: arr(args.right?.items ?? args.right_items).map(str).slice(0, 5) };
    v.both = arr(args.both).map(str).slice(0, 4);
    if (!v.left.title && !v.right.title) return null;
  } else if (kind === 'steps') {
    v.items = arr(args.items ?? args.steps).map(item).filter((x) => x.text).slice(0, 6);
    if (!v.items.length) return null;
  } else if (kind === 'emoji_cards') {
    v.items = arr(args.items ?? args.cards).map(item).filter((x) => x.text || x.emoji).slice(0, 8);
    if (!v.items.length) return null;
  }
  return v;
}

// A short description, so a resumed ALT knows what was on the board.
export function visualSummary(v) {
  switch (v.kind) {
    case 'reality': return `reality "${v.reality.text}" vs imagination "${v.imagination.text}"`;
    case 'timeline': return `timeline: ${v.events.map((e) => `${e.text} (${e.time}${e.real ? '' : ', imagined'})`).join('; ')}`;
    case 'bar_chart': case 'line_chart': return `${v.kind.replace('_', ' ')}: ${v.labels.join(', ')}`;
    case 'table': return `table: ${v.columns.join(' | ')}`;
    case 'venn': return `Venn diagram: ${v.left.title} / ${v.right.title}`;
    case 'sketch': return `a sketch${v.caption ? `: ${v.caption}` : ''}`;
    default: return `${v.kind.replace('_', ' ')}: ${(v.items || []).map((x) => x.text).join(', ')}`;
  }
}

export function visualHTML(v) {
  const body = {
    reality: realityHTML, timeline: timelineSVG, bar_chart: barSVG, line_chart: lineSVG,
    table: tableHTML, venn: vennSVG, steps: stepsHTML, emoji_cards: cardsHTML, sketch: sketchSVG,
  }[v.kind]?.(v) || '';
  return `<div class="viz viz-${v.kind}">${body}</div>${v.caption ? `<p class="viz-cap">${esc(v.caption)}</p>` : ''}`;
}

export function pictureHTML(pic, caption) {
  if (!pic) return '<p class="muted">（画像が見つかりません）</p>';
  return `<figure class="viz-pic"><img src="${esc(pic.src)}" alt="${esc(pic.name)}">${caption || pic.name ? `<figcaption>${esc(caption || pic.name)}</figcaption>` : ''}</figure>`;
}

// Finds a picture in the library by the name the ALT used.
export function findPicture(pictures, name) {
  const n = str(name).trim().toLowerCase();
  if (!n) return null;
  const list = pictures || [];
  return list.find((p) => p.name.trim().toLowerCase() === n)
    || list.find((p) => p.name.toLowerCase().includes(n) || n.includes(p.name.toLowerCase()))
    || null;
}

// ---------------------------------------------------------------- the drawings

function realityHTML(v) {
  return `
    <div class="rv">
      <div class="rv-box real"><div class="rv-tag">🌏 Reality <small>現実</small></div><b>${esc(v.reality.text)}</b>${v.reality.note ? `<span>${esc(v.reality.note)}</span>` : ''}</div>
      <div class="rv-gap"><span>⟵ ${esc(v.gap)} ⟶</span></div>
      <div class="rv-box dream"><div class="rv-tag">💭 Imagination <small>もしもの世界</small></div><b>${esc(v.imagination.text)}</b>${v.imagination.note ? `<span>${esc(v.imagination.note)}</span>` : ''}</div>
    </div>`;
}

function wrapText(text, max) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > max && line) { lines.push(line); line = w; } else line = (line + ' ' + w).trim();
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}
const tspans = (lines, x, dy) => lines.map((l, i) => `<tspan x="${x}" dy="${i ? dy : 0}">${esc(l)}</tspan>`).join('');

function timelineSVG(v) {
  const y = v.events.some((e) => !e.real) ? 300 : 90; // room above the line only for dream bubbles
  const W = 1000, H = y + 170;
  const xs = { past: 190, now: 500, future: 810 };
  const groups = { past: [], now: [], future: [] };
  v.events.forEach((e) => groups[e.time].push(e));
  let marks = '';
  for (const t of ['past', 'now', 'future']) {
    marks += `<line x1="${xs[t]}" y1="${y - 14}" x2="${xs[t]}" y2="${y + 14}" stroke="#123A6B" stroke-width="4"/>
      <text x="${xs[t]}" y="${y + 50}" class="t-axis">${t === 'past' ? 'PAST 過去' : t === 'now' ? 'NOW 現在' : 'FUTURE 未来'}</text>`;
    const real = groups[t].filter((e) => e.real);
    const dream = groups[t].filter((e) => !e.real);
    real.forEach((e, i) => {
      const yy = y + 95 + i * 62;
      marks += `<circle cx="${xs[t]}" cy="${y}" r="11" fill="#1E5AA0"/>
        <text x="${xs[t]}" y="${yy}" class="t-real">${tspans(wrapText(e.text, 24), xs[t], 26)}</text>`;
    });
    // Imagined events float above the line in dream bubbles (up to two per point in time).
    let bottom = y - 30;
    dream.slice(0, 2).reverse().forEach((e) => {
      const lines = wrapText(e.text, 24);
      const h = 24 + lines.length * 30;
      const top = bottom - h;
      marks += `<line x1="${xs[t]}" y1="${y - 14}" x2="${xs[t]}" y2="${bottom}" stroke="#E8833A" stroke-width="3" stroke-dasharray="8 7"/>
        <rect x="${xs[t] - 175}" y="${top}" width="350" height="${h}" rx="24" fill="#FFF3E6" stroke="#E8833A" stroke-width="3" stroke-dasharray="10 6"/>
        <text x="${xs[t]}" y="${top + 34}" class="t-dream">${tspans(lines.map((l, k) => (k ? l : `💭 ${l}`)), xs[t], 30)}</text>`;
      bottom = top - 12;
    });
  }
  const tall = Math.max(...Object.values(groups).map((g) => g.filter((e) => e.real).length));
  const h = Math.max(H, y + 95 + tall * 62);
  return `<svg viewBox="0 0 ${W} ${h}" role="img" aria-label="timeline">
    <defs><marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#123A6B"/></marker></defs>
    <line x1="40" y1="${y}" x2="960" y2="${y}" stroke="#123A6B" stroke-width="5" marker-end="url(#arr)"/>
    ${marks}</svg>`;
}

function axes(v, W, H, pad) {
  const max = Math.max(1, ...v.series.flatMap((s) => s.values));
  const nice = niceMax(max);
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const val = (nice / 4) * i;
    const yy = H - pad.b - ((H - pad.t - pad.b) * i) / 4;
    g += `<line x1="${pad.l}" y1="${yy}" x2="${W - pad.r}" y2="${yy}" stroke="#D9E2EF" stroke-width="2"/>
      <text x="${pad.l - 14}" y="${yy + 9}" class="c-y">${fmt(val)}</text>`;
  }
  return { nice, g };
}
const niceMax = (m) => { const p = 10 ** Math.floor(Math.log10(m)); return Math.ceil(m / p) * p; };
const fmt = (n) => (Math.round(n * 10) / 10).toLocaleString('en-US');
const legend = (v, W) => v.series.length > 1 || v.series[0]?.name
  ? v.series.map((s, i) => `<g transform="translate(${80 + i * 220}, 34)"><rect width="26" height="26" rx="6" fill="${COLORS[i]}"/><text x="38" y="22" class="c-leg">${esc(s.name)}</text></g>`).join('')
  : '';

function barSVG(v) {
  const W = 1000, H = 560, pad = { l: 100, r: 30, t: v.series.length > 1 || v.series[0]?.name ? 80 : 40, b: 90 };
  const { nice, g } = axes(v, W, H, pad);
  const n = v.labels.length, k = v.series.length;
  const slot = (W - pad.l - pad.r) / n;
  const bw = Math.min(110, (slot * 0.72) / k);
  let bars = '';
  v.labels.forEach((lab, i) => {
    const x0 = pad.l + slot * i + (slot - bw * k) / 2;
    v.series.forEach((s, j) => {
      const val = s.values[i] ?? 0;
      const h = ((H - pad.t - pad.b) * val) / nice;
      const x = x0 + j * bw;
      bars += `<rect x="${x}" y="${H - pad.b - h}" width="${bw - 6}" height="${h}" rx="6" fill="${COLORS[j]}"/>
        <text x="${x + (bw - 6) / 2}" y="${H - pad.b - h - 10}" class="c-val">${fmt(val)}${esc(v.unit)}</text>`;
    });
    bars += `<text x="${pad.l + slot * i + slot / 2}" y="${H - pad.b + 42}" class="c-x">${esc(lab)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="bar chart">${legend(v, W)}${g}${bars}
    <line x1="${pad.l}" y1="${H - pad.b}" x2="${W - pad.r}" y2="${H - pad.b}" stroke="#123A6B" stroke-width="3"/></svg>`;
}

function lineSVG(v) {
  const W = 1000, H = 560, pad = { l: 100, r: 50, t: v.series.length > 1 || v.series[0]?.name ? 80 : 40, b: 90 };
  const { nice, g } = axes(v, W, H, pad);
  const n = v.labels.length;
  const xAt = (i) => pad.l + 30 + ((W - pad.l - pad.r - 60) * i) / Math.max(1, n - 1);
  const yAt = (val) => H - pad.b - ((H - pad.t - pad.b) * val) / nice;
  let lines = '';
  v.series.forEach((s, j) => {
    const pts = s.values.map((val, i) => `${xAt(i)},${yAt(val)}`).join(' ');
    lines += `<polyline points="${pts}" fill="none" stroke="${COLORS[j]}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>`;
    s.values.forEach((val, i) => {
      lines += `<circle cx="${xAt(i)}" cy="${yAt(val)}" r="9" fill="#fff" stroke="${COLORS[j]}" stroke-width="5"/>`;
      if (v.series.length === 1) lines += `<text x="${xAt(i)}" y="${yAt(val) - 20}" class="c-val">${fmt(val)}${esc(v.unit)}</text>`;
    });
  });
  const xl = v.labels.map((lab, i) => `<text x="${xAt(i)}" y="${H - pad.b + 42}" class="c-x">${esc(lab)}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="line chart">${legend(v, W)}${g}${lines}${xl}
    <line x1="${pad.l}" y1="${H - pad.b}" x2="${W - pad.r}" y2="${H - pad.b}" stroke="#123A6B" stroke-width="3"/></svg>`;
}

function tableHTML(v) {
  return `<table class="viz-table">${v.columns.length ? `<thead><tr>${v.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>` : ''}
    <tbody>${v.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function vennSVG(v) {
  const W = 1000, H = 520;
  const list = (items, x, y0) => items.map((t, i) => `<text x="${x}" y="${y0 + i * 44}" class="v-item">${esc(t.length > 22 ? `${t.slice(0, 21)}…` : t)}</text>`).join('');
  const start = (n) => 270 - ((n - 1) * 44) / 2;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Venn diagram">
    <circle cx="370" cy="280" r="220" fill="#1E5AA0" fill-opacity=".14" stroke="#1E5AA0" stroke-width="4"/>
    <circle cx="630" cy="280" r="220" fill="#E8833A" fill-opacity=".16" stroke="#E8833A" stroke-width="4"/>
    <text x="300" y="42" class="v-title" fill="#1E5AA0">${esc(v.left.title)}</text>
    <text x="700" y="42" class="v-title" fill="#C2410C">${esc(v.right.title)}</text>
    ${list(v.left.items, 270, start(v.left.items.length))}
    ${list(v.both, 500, start(v.both.length))}
    ${list(v.right.items, 730, start(v.right.items.length))}
  </svg>`;
}

function stepsHTML(v) {
  return `<ol class="viz-steps">${v.items.map((x, i) => `<li><span class="n">${i + 1}</span><div><b>${esc(x.emoji ? `${x.emoji} ` : '')}${esc(x.text)}</b>${x.note ? `<small>${esc(x.note)}</small>` : ''}</div></li>`).join('<li class="arrow" aria-hidden="true">➜</li>')}</ol>`;
}

function cardsHTML(v) {
  return `<div class="viz-cards">${v.items.map((x) => `<div class="ecard"><div class="em">${esc(x.emoji || '🔹')}</div><b>${esc(x.text)}</b>${x.note ? `<small>${esc(x.note)}</small>` : ''}</div>`).join('')}</div>`;
}

// ---------------------------------------------------------------- sketches (the ALT draws simple line pictures)
//
// The ALT sends shapes on a 400 x 300 canvas. Only plain shapes are accepted (no code, no links),
// and everything is checked before it is drawn.

const SKETCH_COLORS = { black: '#1F2A37', navy: '#123A6B', blue: '#1E5AA0', red: '#C0392B', orange: '#E8833A', yellow: '#F2B705', green: '#1F9D61', brown: '#8B5A2B', pink: '#E86A92', purple: '#8E44AD', gray: '#7A8699', white: '#FFFFFF', skyblue: '#7EC8F2' };
const color = (c, dflt) => {
  const s = str(c).trim().toLowerCase();
  if (SKETCH_COLORS[s]) return SKETCH_COLORS[s];
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/.test(s)) return s;
  return dflt;
};
const cn = (x, lo = -50, hi = 450) => Math.max(lo, Math.min(hi, Math.round(num(x) * 10) / 10));

export function normalizeSketch(args = {}) {
  const shapes = [];
  for (const raw of arr(args.shapes).slice(0, 80)) {
    if (!raw || typeof raw !== 'object') continue;
    const s = {
      type: str(raw.type).toLowerCase(),
      stroke: color(raw.color ?? raw.stroke, SKETCH_COLORS.black),
      fill: raw.fill ? color(raw.fill, 'none') : 'none',
      w: Math.max(1, Math.min(14, num(raw.width ?? raw.stroke_width) || 4)),
    };
    if (s.type === 'path') {
      const d = str(raw.d).trim();
      if (!d || d.length > 3000 || !/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s\-eE]+$/.test(d)) continue;
      s.d = d;
    } else if (s.type === 'line') {
      Object.assign(s, { x1: cn(raw.x1), y1: cn(raw.y1), x2: cn(raw.x2), y2: cn(raw.y2) });
    } else if (s.type === 'circle') {
      Object.assign(s, { cx: cn(raw.cx), cy: cn(raw.cy), r: cn(raw.r, 1, 300) });
    } else if (s.type === 'ellipse') {
      Object.assign(s, { cx: cn(raw.cx), cy: cn(raw.cy), rx: cn(raw.rx, 1, 300), ry: cn(raw.ry, 1, 300) });
    } else if (s.type === 'rect') {
      Object.assign(s, { x: cn(raw.x), y: cn(raw.y), wd: cn(raw.w ?? raw.width_px ?? raw.rect_width, 1, 450), ht: cn(raw.h ?? raw.height, 1, 350), rx: cn(raw.rx ?? 0, 0, 100) });
    } else if (s.type === 'polyline' || s.type === 'polygon') {
      const pts = arr(raw.points).map((p) => (Array.isArray(p) ? p : [p?.x, p?.y])).map(([x, y]) => `${cn(x)},${cn(y)}`).slice(0, 120);
      if (pts.length < 2) continue;
      s.points = pts.join(' ');
    } else if (s.type === 'text') {
      s.text = str(raw.text).slice(0, 40);
      if (!s.text) continue;
      Object.assign(s, { x: cn(raw.x), y: cn(raw.y), size: Math.max(10, Math.min(48, num(raw.size) || 22)) });
      s.fill = color(raw.color ?? raw.fill, SKETCH_COLORS.black);
    } else continue;
    shapes.push(s);
  }
  if (!shapes.length) return null;
  return { kind: 'sketch', caption: str(args.caption), shapes };
}

function sketchSVG(v) {
  const common = (s) => `stroke="${s.stroke}" stroke-width="${s.w}" fill="${s.fill}" stroke-linecap="round" stroke-linejoin="round"`;
  const el = v.shapes.map((s) => {
    switch (s.type) {
      case 'path': return `<path d="${s.d}" ${common(s)}/>`;
      case 'line': return `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" ${common(s)}/>`;
      case 'circle': return `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" ${common(s)}/>`;
      case 'ellipse': return `<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}" ${common(s)}/>`;
      case 'rect': return `<rect x="${s.x}" y="${s.y}" width="${s.wd}" height="${s.ht}" rx="${s.rx}" ${common(s)}/>`;
      case 'polyline': return `<polyline points="${s.points}" ${common(s)}/>`;
      case 'polygon': return `<polygon points="${s.points}" ${common(s)}/>`;
      case 'text': return `<text x="${s.x}" y="${s.y}" font-size="${s.size}" fill="${s.fill}" class="sk-text">${esc(s.text)}</text>`;
      default: return '';
    }
  }).join('');
  return `<svg viewBox="0 0 400 300" role="img" aria-label="sketch">${el}</svg>`;
}

// ---------------------------------------------------------------- AI illustrations (made on request, ~30 s)

export function illustrationHTML(c) {
  if (c.status === 'pending') {
    return `<div class="illu-wait"><div class="illu-brush">🎨</div><b>イラストを描いています…</b><span data-since="${c.started}">0 秒</span><small>${esc(c.prompt)}</small></div>`;
  }
  if (c.status === 'error') return `<div class="illu-wait err"><b>イラストを作れませんでした</b><small>${esc(c.error || '')}</small></div>`;
  return `<figure class="viz-pic"><img src="${esc(c.src)}" alt="${esc(c.prompt)}">${c.caption ? `<figcaption>${esc(c.caption)}</figcaption>` : ''}</figure>`;
}

// ---------------------------------------------------------------- drawing animation
//
// Lines are drawn stroke by stroke and the rest fades in, as if the ALT were drawing on the board.
// Returns how long the drawing takes (ms), so the avatar can "draw" for that long.
export function animateDrawing(root) {
  if (!root || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 0;
  const svg = root.querySelector('.viz svg');
  let t = 0;
  if (svg) {
    const shapes = [...svg.querySelectorAll('path, line, polyline, polygon, rect, circle, ellipse')];
    const per = Math.max(60, Math.min(260, 2400 / Math.max(1, shapes.length)));
    for (const s of shapes) {
      const dashed = s.getAttribute('stroke-dasharray');
      let len = 0;
      try { len = s.getTotalLength(); } catch { len = 0; }
      const filled = (s.getAttribute('fill') || 'none') !== 'none';
      if (!dashed && len > 0) {
        s.animate([{ strokeDasharray: `${len}`, strokeDashoffset: `${len}` }, { strokeDasharray: `${len}`, strokeDashoffset: '0' }],
          { duration: per * 1.6, delay: t, easing: 'ease-in-out', fill: 'backwards' });
        if (filled) s.animate([{ fillOpacity: 0 }, { fillOpacity: s.getAttribute('fill-opacity') || 1 }], { duration: 300, delay: t + per * 1.4, fill: 'backwards' });
      } else {
        s.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: t, fill: 'backwards' });
      }
      t += per;
    }
    for (const x of svg.querySelectorAll('text')) x.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 350, delay: t * 0.6, fill: 'backwards' });
    return t + per * 1.6;
  }
  const parts = root.querySelectorAll('.viz > * > *, .viz > table tr, .viz-pic');
  parts.forEach((p, i) => {
    p.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: i * 140, easing: 'ease-out', fill: 'backwards' });
    t = i * 140 + 380;
  });
  return t;
}
