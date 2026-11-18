// PowerPoint slides on the display: one picture per click step (made by
// tools/pptx2aialt.py) and the click animations replayed on top of them.
//
// For each click, the shapes that change are cut out of the next picture (only the
// pixels that differ from the current one, so the background never moves) and
// animated into place: fade, fly in, wipe, float, zoom or appear.

const cache = new Map();
export function loadImage(src) {
  if (!cache.has(src)) {
    cache.set(src, new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => resolve(img));
      img.onerror = reject;
      img.src = src;
    }));
  }
  return cache.get(src);
}
export const preload = (slide) => slide?.deck?.steps.forEach((s) => loadImage(s).catch(() => {}));

const clampBox = ([x, y, w, h]) => {
  const x0 = Math.max(0, x), y0 = Math.max(0, y);
  const x1 = Math.min(1, x + w), y1 = Math.min(1, y + h);
  return x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : null;
};

// The pixels inside `box` that differ between two pictures, taken from `pick`.
async function cutout(fromSrc, toSrc, box, pickNew) {
  const [a, b] = await Promise.all([loadImage(fromSrc), loadImage(toSrc)]);
  const W = b.naturalWidth, H = b.naturalHeight;
  const x = Math.floor(box[0] * W), y = Math.floor(box[1] * H);
  const w = Math.max(1, Math.min(W - x, Math.ceil(box[2] * W))), h = Math.max(1, Math.min(H - y, Math.ceil(box[3] * H)));
  const make = (img) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, x, y, w, h, 0, 0, w, h);
    return c;
  };
  const keep = make(pickNew ? b : a);
  const other = make(pickNew ? a : b).getContext('2d').getImageData(0, 0, w, h).data;
  const g = keep.getContext('2d');
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const diff = Math.abs(d[i] - other[i]) + Math.abs(d[i + 1] - other[i + 1]) + Math.abs(d[i + 2] - other[i + 2]);
    if (diff < 30) d[i + 3] = 0;
  }
  g.putImageData(img, 0, 0);
  return keep;
}

function keyframes(e, box) {
  const [x, y, w, h] = box;
  switch (e.kind) {
    case 'fly': {
      const from = {
        left: `translateX(${-((x + w) / w) * 100}%)`,
        right: `translateX(${((1 - x) / w) * 100}%)`,
        top: `translateY(${-((y + h) / h) * 100}%)`,
        bottom: `translateY(${((1 - y) / h) * 100}%)`,
      }[e.dir || 'bottom'];
      return [{ transform: from }, { transform: 'none' }];
    }
    case 'wipe': {
      const from = { left: 'inset(0 100% 0 0)', right: 'inset(0 0 0 100%)', top: 'inset(0 0 100% 0)', bottom: 'inset(100% 0 0 0)' }[e.dir || 'left'];
      return [{ clipPath: from }, { clipPath: 'inset(0 0 0 0)' }];
    }
    case 'float': return [{ opacity: 0, transform: 'translateY(25%)' }, { opacity: 1, transform: 'none' }];
    case 'zoom': return [{ opacity: 0, transform: 'scale(.3)' }, { opacity: 1, transform: 'none' }];
    case 'appear': return [{ opacity: 0 }, { opacity: 0, offset: 0.999 }, { opacity: 1 }];
    default: return [{ opacity: 0 }, { opacity: 1 }];
  }
}

export class Stage {
  constructor(el, aspect = 16 / 9) {
    this.el = el;
    el.classList.add('stage');
    el.style.setProperty('--ar', aspect);
    this.base = document.createElement('img');
    this.base.className = 'stage-base';
    this.base.alt = '';
    this.base.draggable = false;
    el.appendChild(this.base);
    this.pending = null;
  }

  show(src) {
    this.finish();
    this.base.src = src;
  }

  finish() {
    this.pending?.();
  }

  // Plays one click: from the picture on screen to `toSrc`.
  async play(fromSrc, toSrc, effects = []) {
    this.finish();
    const overlays = [];
    const anims = [];
    let done = false;
    const finalize = () => {
      if (done) return;
      done = true;
      anims.forEach((a) => { try { a.finish(); } catch {} });
      this.base.src = toSrc;
      overlays.forEach((o) => o.remove());
      if (this.pending === finalize) this.pending = null;
    };
    this.pending = finalize;
    const entering = effects.filter((e) => !e.exit);
    if (!effects.length) return finalize();

    // Only exits: the new picture goes underneath and the leaving shapes fade out on top.
    const exitsOnly = !entering.length;
    if (exitsOnly) this.base.src = toSrc;
    try {
      const parts = await Promise.all((exitsOnly ? effects : entering).map(async (e) => {
        const box = clampBox(e.box);
        if (!box) return null;
        return { e, box, canvas: await cutout(fromSrc, toSrc, box, !exitsOnly) };
      }));
      if (done) return;
      for (const p of parts) {
        if (!p) continue;
        const o = document.createElement('div');
        o.className = 'stage-fx';
        Object.assign(o.style, { left: `${p.box[0] * 100}%`, top: `${p.box[1] * 100}%`, width: `${p.box[2] * 100}%`, height: `${p.box[3] * 100}%` });
        o.appendChild(p.canvas);
        this.el.appendChild(o);
        overlays.push(o);
        const frames = exitsOnly ? [{ opacity: 1 }, { opacity: 0 }] : keyframes(p.e, p.box);
        anims.push(o.animate(frames, { duration: Math.max(p.e.dur, 1), delay: p.e.start || 0, easing: p.e.kind === 'fly' ? 'cubic-bezier(.2,.7,.3,1)' : 'ease-out', fill: 'both' }));
      }
      await Promise.all(anims.map((a) => a.finished.catch(() => {})));
    } catch (err) {
      console.warn('animation', err);
    }
    finalize();
  }

  // Moving to another slide: a short cross-fade when the slide has a transition.
  async transition(toSrc, fade) {
    this.finish();
    if (!fade) { this.base.src = toSrc; return; }
    const img = document.createElement('img');
    img.className = 'stage-fx full';
    img.src = toSrc;
    this.el.appendChild(img);
    let done = false;
    const anim = img.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 450, easing: 'ease-in-out', fill: 'both' });
    const finalize = () => {
      if (done) return;
      done = true;
      try { anim.finish(); } catch {}
      this.base.src = toSrc;
      img.remove();
      if (this.pending === finalize) this.pending = null;
    };
    this.pending = finalize;
    await anim.finished.catch(() => {});
    finalize();
  }
}
