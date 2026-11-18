// Lesson editor: the ALT, the lesson plan the ALT follows, and the slides on the display.
// Changes are saved automatically.

import { ALTS, avatarHTML, altKey } from './avatars.js';
import { getLesson, saveLesson, blankSlide } from './store.js';
import { $, $$, esc, toast, richText, readImage, confirmDialog } from './util.js';

export async function renderEditor(el, id) {
  const lesson = await getLesson(id);
  if (!lesson) { location.hash = '#/'; return; }
  el.className = 'page';

  let timer = 0;
  const save = () => {
    clearTimeout(timer);
    $('#saved', el).textContent = '保存中…';
    timer = setTimeout(async () => {
      try {
        await saveLesson(lesson);
        $('#saved', el).textContent = '✓ 保存しました';
      } catch (err) {
        $('#saved', el).textContent = '保存できませんでした';
        toast(`保存できませんでした: ${err.message}`, 'error');
      }
    }, 500);
  };

  const slideHTML = (s, i) => `
    <article class="slide-edit" data-i="${i}">
      <div class="slide-edit-head">
        <b>スライド ${i + 1}</b>
        <div class="row">
          <button class="btn btn-ghost btn-sm" data-move="-1" ${i === 0 ? 'disabled' : ''} title="上へ">↑</button>
          <button class="btn btn-ghost btn-sm" data-move="1" ${i === lesson.slides.length - 1 ? 'disabled' : ''} title="下へ">↓</button>
          <button class="btn btn-ghost btn-sm" data-remove title="削除">🗑</button>
        </div>
      </div>
      <div class="slide-edit-grid">
        <div class="fields">
          <label>見出し<input data-f="title" value="${esc(s.title)}" placeholder="例：Second Conditional"></label>
          <label>本文 <small class="muted">1行ずつ表示。「- 」で箇条書き、**語句** で強調（黄色マーカー）</small>
            <textarea data-f="body" rows="6" placeholder="If I **had** a bigger kitchen, I **would invite** my friends.">${esc(s.body)}</textarea></label>
          <div class="img-field">
            <span>画像・図</span>
            ${s.image ? `<img src="${esc(s.image)}" alt="">` : ''}
            <label class="btn btn-ghost btn-sm">🖼 ${s.image ? '画像を変更' : '画像を追加'}<input type="file" accept="image/*" data-img hidden></label>
            ${s.image ? '<button class="btn btn-ghost btn-sm" data-noimg>画像を外す</button>' : ''}
          </div>
          <label>ALTへのメモ <small class="muted">生徒には見えません（この場面でALTにしてほしいこと・答えなど）</small>
            <textarea data-f="note" rows="2">${esc(s.note)}</textarea></label>
        </div>
        <div class="mini-screen">${slideView(s)}</div>
      </div>
    </article>`;

  const draw = () => {
    el.innerHTML = `
      <header class="top">
        <a class="btn btn-ghost" href="#/">← レッスン一覧</a>
        <div class="row"><span class="mini muted" id="saved"></span>
          <a class="btn btn-primary" href="#/class/${encodeURIComponent(lesson.id)}">▶ 授業を始める</a></div>
      </header>
      <section class="card">
        <label>レッスン名<input id="title" value="${esc(lesson.title)}"></label>
        <div class="field-label">担当ALT</div>
        <div class="alt-pick-row">
          ${Object.entries(ALTS).map(([k, a]) => `
            <button type="button" class="alt-opt ${altKey(lesson.alt) === k ? 'on' : ''}" data-alt="${k}">
              ${avatarHTML(k, { framing: 'face' })}<span>${a.name} ${a.flag}</span></button>`).join('')}
        </div>
        <label>生徒のレベル <small class="muted">ALTが話し方を合わせます（英語でも日本語でも可）</small>
          <input id="level" value="${esc(lesson.level)}" placeholder="例：大学1〜2年生、CEFR A2〜B1"></label>
        <label>ALTへの指示（授業の流れ・役割・台本） <small class="muted">ALTはこの内容に沿って動きます。英語で書くとより正確です</small>
          <textarea id="plan" rows="12" placeholder="例：When the teacher asks 'Where do you live?', answer with this script: ...">${esc(lesson.plan)}</textarea></label>
        <label class="check"><input type="checkbox" id="greet" ${lesson.greet ? 'checked' : ''}> 開始時にALTがクラスにあいさつする</label>
      </section>
      <h2>ディスプレイのスライド</h2>
      <div id="slides">${lesson.slides.map(slideHTML).join('')}</div>
      <button class="btn btn-ghost add-slide" id="add">＋ スライドを追加</button>`;

    $('#title', el).oninput = (e) => { lesson.title = e.target.value; save(); };
    $('#level', el).oninput = (e) => { lesson.level = e.target.value; save(); };
    $('#plan', el).oninput = (e) => { lesson.plan = e.target.value; save(); };
    $('#greet', el).onchange = (e) => { lesson.greet = e.target.checked; save(); };
    $$('[data-alt]', el).forEach((b) => (b.onclick = () => {
      lesson.alt = b.dataset.alt;
      $$('[data-alt]', el).forEach((x) => x.classList.toggle('on', x === b));
      save();
    }));
    $('#add', el).onclick = () => {
      lesson.slides.push(blankSlide());
      save();
      draw();
      $$('.slide-edit', el).pop()?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    $$('.slide-edit', el).forEach((card) => {
      const i = +card.dataset.i;
      const s = lesson.slides[i];
      const preview = () => { $('.mini-screen', card).innerHTML = slideView(s); };
      $$('[data-f]', card).forEach((f) => (f.oninput = () => { s[f.dataset.f] = f.value; save(); preview(); }));
      $$('[data-move]', card).forEach((b) => (b.onclick = () => {
        const j = i + +b.dataset.move;
        [lesson.slides[i], lesson.slides[j]] = [lesson.slides[j], lesson.slides[i]];
        save();
        draw();
      }));
      $('[data-remove]', card).onclick = async () => {
        if (lesson.slides.length === 1) { toast('スライドは1枚以上必要です'); return; }
        if (!(await confirmDialog(`スライド ${i + 1} を削除しますか？`, '削除'))) return;
        lesson.slides.splice(i, 1);
        save();
        draw();
      };
      $('[data-img]', card).onchange = async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try {
          s.image = await readImage(f);
          save();
          draw();
        } catch (err) { toast(err.message, 'error'); }
      };
      $('[data-noimg]', card)?.addEventListener('click', () => { s.image = ''; save(); draw(); });
    });
  };
  draw();
  return () => clearTimeout(timer);
}

// One slide as it appears on the display (also used by the classroom).
export function slideView(s) {
  const hasText = Boolean((s.title || '').trim() || (s.body || '').trim());
  const cls = s.image ? (hasText ? 'has-image' : 'image-only') : '';
  return `
    <div class="slide ${cls}">
      ${hasText ? `<div class="slide-text">
        ${s.title ? `<h2>${esc(s.title)}</h2>` : ''}
        <div class="slide-body">${richText(s.body)}</div>
      </div>` : ''}
      ${s.image ? `<figure><img src="${esc(s.image)}" alt=""></figure>` : ''}
      ${!hasText && !s.image ? '<div class="slide-blank"></div>' : ''}
    </div>`;
}
