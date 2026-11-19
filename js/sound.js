// Sounds from PowerPoint: sound effects on clicks and slide transitions (short, fire and forget)
// and audio on a slide ("tracks": music, a recording) that can keep playing over several slides.

export class SoundPlayer {
  constructor(onChange) {
    this.onChange = onChange || (() => {});
    this.tracks = new Map(); // id -> { audio, first, last }
    this.effects = new Set();
    this.timers = new Set();
  }

  // Sounds of one slide that belong to a click (0 = when the slide appears).
  playAt(slide, slideIndex, at) {
    for (const snd of slide?.deck?.sounds || []) {
      if (snd.at !== at) continue;
      this.later(snd.start, () => (snd.kind === 'track' ? this.track(snd, slideIndex) : this.effect(snd.src)));
    }
  }

  transition(slide) {
    const t = slide?.deck?.transitionSound;
    if (!t) return;
    if (t.stop) this.stopAll();
    else if (t.src) this.effect(t.src, t.loop);
  }

  later(ms, fn) {
    if (!ms) return fn();
    const id = setTimeout(() => { this.timers.delete(id); fn(); }, ms);
    this.timers.add(id);
  }

  effect(src, loop = false) {
    const a = new Audio(src);
    a.loop = loop;
    this.effects.add(a);
    a.onended = () => this.effects.delete(a);
    a.play().catch(() => this.effects.delete(a));
  }

  track(snd, slideIndex) {
    const cur = this.tracks.get(snd.id);
    if (snd.cmd === 'togglePause') {
      if (cur) {
        if (cur.audio.paused) cur.audio.play().catch(() => {});
        else cur.audio.pause();
        this.onChange();
      }
      return;
    }
    if (snd.cmd === 'stop') { this.stop(snd.id); return; }
    if (cur) this.stop(snd.id);
    const audio = new Audio(snd.src);
    audio.volume = Math.max(0, Math.min(1, snd.vol ?? 1));
    audio.loop = Boolean(snd.loop);
    audio.currentTime = snd.from || 0;
    const t = { audio, first: slideIndex, last: slideIndex + Math.max(1, snd.slides || 1) - 1, name: snd.name || '' };
    this.tracks.set(snd.id, t);
    audio.onended = () => { if (this.tracks.get(snd.id) === t) { this.tracks.delete(snd.id); this.onChange(); } };
    audio.onplay = audio.onpause = () => this.onChange();
    audio.play().catch(() => { this.tracks.delete(snd.id); this.onChange(); });
    this.onChange();
  }

  // Moving to another slide: music ends where PowerPoint would end it.
  arrive(slideIndex) {
    for (const [id, t] of this.tracks) {
      if (slideIndex < t.first || slideIndex > t.last) this.stop(id, true);
    }
    for (const a of this.effects) { if (a.loop) { a.pause(); this.effects.delete(a); } }
    this.onChange();
  }

  stop(id, quiet = false) {
    const t = this.tracks.get(id);
    if (!t) return;
    t.audio.onended = t.audio.onplay = t.audio.onpause = null;
    t.audio.pause();
    this.tracks.delete(id);
    if (!quiet) this.onChange();
  }

  stopAll() {
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    for (const id of [...this.tracks.keys()]) this.stop(id, true);
    for (const a of this.effects) a.pause();
    this.effects.clear();
    this.onChange();
  }

  get playing() {
    return [...this.tracks.values()].some((t) => !t.audio.paused);
  }

  get any() {
    return this.tracks.size > 0 || this.effects.size > 0;
  }
}

export const hasSounds = (slide) => Boolean(slide?.deck?.sounds?.length || slide?.deck?.transitionSound?.src);
