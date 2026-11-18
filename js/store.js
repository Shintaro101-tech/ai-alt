// Lessons are kept in this browser (IndexedDB, so pictures fit) and can be exported
// as JSON files to keep or move to another computer.

import { uid } from './util.js';
import { SAMPLE_LESSON } from './sample.js';

const DB = 'ai-alt';
const STORE = 'lessons';
let dbp = null;

function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
}

export async function listLessons() {
  const all = (await tx('readonly', (s) => s.getAll())) || [];
  return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
export const getLesson = (id) => tx('readonly', (s) => s.get(id));
export const deleteLesson = (id) => tx('readwrite', (s) => s.delete(id));
export async function saveLesson(lesson) {
  lesson.updatedAt = Date.now();
  await tx('readwrite', (s) => s.put(lesson));
  return lesson;
}

export function blankLesson() {
  return {
    id: uid(),
    title: '新しいレッスン',
    alt: 'emma',
    level: '',
    plan: '',
    slides: [blankSlide()],
  };
}
export const blankSlide = () => ({ id: uid(), title: '', body: '', image: '', note: '' });

// Turns an imported JSON file (or a copy) into a lesson with fresh ids.
export function normalizeLesson(raw, { fresh = true } = {}) {
  const l = { ...blankLesson(), ...raw };
  if (fresh) l.id = uid();
  l.slides = (Array.isArray(raw.slides) ? raw.slides : []).map((s) => ({ ...blankSlide(), ...s, id: uid() }));
  if (!l.slides.length) l.slides = [blankSlide()];
  return l;
}

// The sample lesson is added once, on the first visit.
export async function seedSample() {
  let seeded = false;
  try { seeded = localStorage.getItem('aialt:seeded') === '1'; } catch {}
  if (seeded) return;
  await saveLesson(normalizeLesson(SAMPLE_LESSON));
  try { localStorage.setItem('aialt:seeded', '1'); } catch {}
}
export const addSample = () => saveLesson(normalizeLesson(SAMPLE_LESSON));
