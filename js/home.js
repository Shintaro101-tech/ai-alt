// Lesson list.

import { ALTS, avatarHTML, altKey } from './avatars.js';
import { listLessons, saveLesson, deleteLesson, blankLesson, normalizeLesson, addSample, getLesson } from './store.js';
import { ensurePasscode, getPasscode } from './api.js';
import { $, $$, esc, toast, confirmDialog } from './util.js';

export async function renderHome(el) {
  el.className = 'page';
  const draw = async () => {
    const lessons = await listLessons();
    el.innerHTML = `
      <header class="top">
        <div class="brand"><span class="logo">AI</span><div><b>AI-ALT</b><small>Your AI Assistant Language Teachers</small></div></div>
        <div class="top-actions">
          <button class="btn btn-ghost" id="pass">🔒 合言葉${getPasscode() ? '（設定済み）' : ''}</button>
        </div>
      </header>

      <section class="alts">
        ${Object.entries(ALTS).map(([k, a]) => `
          <div class="alt-card">
            ${avatarHTML(k, { framing: 'face' })}
            <div><b>${a.name}</b> <span class="muted">${a.flag} ${a.from}</span><p class="mini">${esc(a.profile)}</p></div>
          </div>`).join('')}
      </section>

      <section>
        <div class="section-head">
          <h2>レッスン</h2>
          <div class="row">
            <button class="btn btn-ghost" id="import">📥 読み込む</button>
            <button class="btn btn-primary" id="new">＋ 新しいレッスン</button>
          </div>
        </div>
        ${lessons.length ? `<div class="lessons">${lessons.map((l) => `
          <article class="lesson">
            <div class="lesson-av">${avatarHTML(altKey(l.alt), { framing: 'face' })}</div>
            <div class="lesson-info">
              <h3>${esc(l.title || '無題のレッスン')}</h3>
              <p class="mini muted">ALT: ${ALTS[altKey(l.alt)].name} ・ スライド ${l.slides.length}枚${l.level ? ` ・ ${esc(l.level)}` : ''}</p>
            </div>
            <div class="lesson-actions">
              <a class="btn btn-primary" href="#/class/${encodeURIComponent(l.id)}">▶ 授業を始める</a>
              <a class="btn btn-ghost" href="#/edit/${encodeURIComponent(l.id)}">✏️ 編集</a>
              <button class="btn btn-ghost" data-copy="${esc(l.id)}" title="複製">⧉</button>
              <button class="btn btn-ghost" data-export="${esc(l.id)}" title="ファイルに書き出す">📤</button>
              <button class="btn btn-ghost" data-del="${esc(l.id)}" title="削除">🗑</button>
            </div>
          </article>`).join('')}</div>`
        : `<div class="empty"><p>レッスンがありません。</p><button class="btn btn-ghost" id="sample">サンプル（Second Conditional）を追加</button></div>`}
      </section>
      <p class="mini muted foot">レッスンはこのブラウザに保存されます。別のPCで使うときや保管には「📤 書き出す」でファイルにしてください。</p>
      <input type="file" id="file" accept="application/json,.json" hidden>`;

    $('#pass', el).onclick = async () => { if (await ensurePasscode('', true)) { toast('合言葉を保存しました', 'success'); draw(); } };
    $('#new', el).onclick = async () => {
      const l = await saveLesson(blankLesson());
      location.hash = `#/edit/${encodeURIComponent(l.id)}`;
    };
    $('#sample', el)?.addEventListener('click', async () => { await addSample(); draw(); });
    $('#import', el).onclick = () => $('#file', el).click();
    $('#file', el).onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const raw = JSON.parse(await f.text());
        if (!raw || !Array.isArray(raw.slides)) throw new Error('AI-ALT のレッスンファイルではありません。');
        await saveLesson(normalizeLesson(raw));
        toast('レッスンを読み込みました', 'success');
        draw();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    $$('[data-copy]', el).forEach((b) => (b.onclick = async () => {
      const l = await getLesson(b.dataset.copy);
      await saveLesson(normalizeLesson({ ...l, title: `${l.title}（コピー）` }));
      draw();
    }));
    $$('[data-export]', el).forEach((b) => (b.onclick = async () => {
      const l = await getLesson(b.dataset.export);
      const { id, updatedAt, ...rest } = l;
      const blob = new Blob([JSON.stringify({ app: 'AI-ALT', version: 1, ...rest }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(l.title || 'lesson').replace(/[\\/:*?"<>|]/g, '_')}.aialt.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }));
    $$('[data-del]', el).forEach((b) => (b.onclick = async () => {
      const l = await getLesson(b.dataset.del);
      if (!(await confirmDialog(`「${l.title}」を削除しますか？（元に戻せません）`, '削除'))) return;
      await deleteLesson(l.id);
      draw();
    }));
  };
  await draw();
}
