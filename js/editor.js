// Lesson editor: the ALT, the lesson plan the ALT follows, and the slides on the display.
// Slides are either made here (text and a picture) or imported from PowerPoint
// (a .pptx is converted by the helper on this Mac — tools/aialt_helper.py — or by hand with
// tools/スライドを変換.command). Changes are saved automatically.

import { ALTS, avatarHTML, altKey } from './avatars.js';
import { LEVELS, LEVEL_KEYS, levelKey } from './levels.js';
import { getLesson, saveLesson, blankSlide } from './store.js';
import { $, $$, esc, toast, richText, readImage, confirmDialog, openDialog, uid } from './util.js';

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
    }, 700);
  };

  const tools = (i) => `
    <div class="row">
      <button class="btn btn-ghost btn-sm" data-move="-1" ${i === 0 ? 'disabled' : ''} title="上へ">↑</button>
      <button class="btn btn-ghost btn-sm" data-move="1" ${i === lesson.slides.length - 1 ? 'disabled' : ''} title="下へ">↓</button>
      <button class="btn btn-ghost btn-sm" data-remove title="削除">🗑</button>
    </div>`;

  const deckHTML = (s, i) => `
    <article class="slide-edit deck" data-i="${i}">
      <div class="slide-edit-head">
        <b>スライド ${i + 1} <span class="tag">PowerPoint${s.deck.steps.length > 1 ? ` ・ クリック ${s.deck.steps.length - 1} 回` : ''}</span></b>
        ${tools(i)}
      </div>
      <div class="slide-edit-grid">
        <div class="fields">
          <label>見出し（一覧・ALT用）<input data-f="title" value="${esc(s.title)}"></label>
          <label>ALTへのメモ <small class="muted">PowerPoint のノートが入ります。学生には見えません</small>
            <textarea data-f="note" rows="3">${esc(s.note)}</textarea></label>
          ${s.deck.text ? `<details class="mini muted"><summary>ALTが読み取ったスライドの文字</summary><pre>${esc(s.deck.text)}</pre></details>` : ''}
        </div>
        <div class="mini-screen deck-thumb"><img src="${s.deck.steps[s.deck.steps.length - 1]}" alt=""></div>
      </div>
    </article>`;

  const slideHTML = (s, i) => s.deck ? deckHTML(s, i) : `
    <article class="slide-edit" data-i="${i}">
      <div class="slide-edit-head">
        <b>スライド ${i + 1}</b>
        ${tools(i)}
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
          <label>ALTへのメモ <small class="muted">学生には見えません（この場面でALTにしてほしいこと・答えなど）</small>
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
        <div class="field-label">学生の英語レベル（CEFR） <small class="muted">ALTが話すスピード・単語・文の長さを合わせます。授業画面でも変えられます</small></div>
        <div class="level-row" id="cefr">${levelButtons(lesson.cefr)}</div>
        <label>学生について（任意） <small class="muted">学年・人数・興味など</small>
          <input id="level" value="${esc(lesson.level)}" placeholder="例：大学1〜2年生、英語が苦手な学生が多い"></label>
        <label>ALTへの指示（授業の流れ・役割・台本） <small class="muted">ALTはこの内容に沿って動きます。英語で書くとより正確です</small>
          <textarea id="plan" rows="12" placeholder="例：When the teacher asks 'Where do you live?', answer with this script: ...">${esc(lesson.plan)}</textarea></label>
      </section>
      <div class="section-head">
        <h2>ディスプレイのスライド</h2>
        <div class="row">
          <button class="btn btn-ghost" id="ppt">📥 PowerPoint を読み込む</button>
          <input type="file" id="pptFile" accept=".json,.pptx,application/json,application/vnd.openxmlformats-officedocument.presentationml.presentation" hidden>
        </div>
      </div>
      <p class="mini muted">PowerPoint（.pptx）を選ぶか、この画面にドラッグすると、自動で変換して読み込みます（アニメーションも再現。このMacに「変換係」が必要です）。</p>
      <div id="slides">${lesson.slides.map(slideHTML).join('')}</div>
      <button class="btn btn-ghost add-slide" id="add">＋ スライドを追加（文字・画像）</button>`;

    $('#title', el).oninput = (e) => { lesson.title = e.target.value; save(); };
    $('#level', el).oninput = (e) => { lesson.level = e.target.value; save(); };
    $('#cefr', el).onclick = (e) => {
      const b = e.target.closest('[data-cefr]');
      if (!b) return;
      lesson.cefr = b.dataset.cefr;
      $('#cefr', el).innerHTML = levelButtons(lesson.cefr);
      save();
    };
    $('#plan', el).oninput = (e) => { lesson.plan = e.target.value; save(); };
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
    $('#ppt', el).onclick = () => $('#pptFile', el).click();
    $('#pptFile', el).onchange = (e) => importDeck(e.target.files[0]);

    $$('.slide-edit', el).forEach((card) => {
      const i = +card.dataset.i;
      const s = lesson.slides[i];
      const preview = () => { if (!s.deck) $('.mini-screen', card).innerHTML = slideView(s); };
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
      $('[data-img]', card)?.addEventListener('change', async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try {
          s.image = await readImage(f);
          save();
          draw();
        } catch (err) { toast(err.message, 'error'); }
      });
      $('[data-noimg]', card)?.addEventListener('click', () => { s.image = ''; save(); draw(); });
    });
  };

  async function importDeck(file) {
    if (!file) return;
    $('#pptFile', el).value = '';
    if (/\.(pptx?|key)$/i.test(file.name)) {
      const raw = await convertWithHelper(file);
      if (raw) await addDeck(raw);
      return;
    }
    let raw;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      toast('ファイルを読み込めませんでした', 'error');
      return;
    }
    if (raw?.kind !== 'slides' || !Array.isArray(raw.slides)) {
      toast('PowerPoint（.pptx）か、変換したスライドのファイル（.aialt-slides.json）を選んでください', 'error');
      return;
    }
    await addDeck(raw);
  }

  async function addDeck(raw) {
    const slides = raw.slides.map((s) => ({
      id: uid(),
      title: s.title || `Slide ${s.number}`,
      body: '',
      image: '',
      note: s.notes || '',
      deck: { steps: s.steps, clicks: s.clicks || [], transition: Boolean(s.transition), text: s.text || '', aspect: raw.aspect || 16 / 9 },
    }));
    const blank = lesson.slides.every((s) => !s.deck && !s.title && !s.body && !s.image);
    let mode = 'replace';
    if (!blank) {
      mode = await new Promise((resolve) => {
        let pick = null;
        const dlg = openDialog(`
          <form class="form">
            <h2>📥 ${esc(raw.name || 'PowerPoint')}（${slides.length}枚）</h2>
            <p>今あるスライドをどうしますか？</p>
            <div class="actions">
              <button type="button" class="btn btn-ghost" data-close>キャンセル</button>
              <button type="button" class="btn btn-ghost" data-pick="append">後ろに追加</button>
              <button type="button" class="btn btn-primary" data-pick="replace">置き換える</button>
            </div>
          </form>`);
        $$('[data-pick]', dlg).forEach((b) => (b.onclick = () => { pick = b.dataset.pick; dlg.close(); }));
        dlg.addEventListener('close', () => resolve(pick), { once: true });
      });
      if (!mode) return;
    }
    lesson.slides = mode === 'append' ? [...lesson.slides, ...slides] : slides;
    save();
    draw();
    toast(`${slides.length}枚のスライドを読み込みました`, 'success');
  }

  // Drop a PowerPoint (or a converted file) anywhere on the editor.
  const drop = new AbortController();
  const on = { signal: drop.signal };
  const isFileDrag = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  el.addEventListener('dragover', (e) => {
    if (!isFileDrag(e) || e.target.closest('.slide-edit')) return;
    e.preventDefault();
    el.classList.add('drop-on');
  }, on);
  el.addEventListener('dragleave', (e) => { if (e.target === el || !el.contains(e.relatedTarget)) el.classList.remove('drop-on'); }, on);
  el.addEventListener('drop', (e) => {
    el.classList.remove('drop-on');
    if (!isFileDrag(e) || e.target.closest('.slide-edit')) return;
    e.preventDefault();
    const file = [...e.dataTransfer.files].find((f) => /\.(pptx?|key|json)$/i.test(f.name));
    if (file) importDeck(file);
    else toast('PowerPoint（.pptx）をドロップしてください', 'error');
  }, on);

  draw();
  return () => { clearTimeout(timer); drop.abort(); el.classList.remove('drop-on'); };
}

// ------------------------------------------------------------------ PowerPoint via the helper on this Mac

const HELPER = 'http://127.0.0.1:8766';

async function helperAlive() {
  try {
    const res = await fetch(`${HELPER}/ping`, { signal: AbortSignal.timeout(2500) });
    return (await res.json()).ok === true;
  } catch {
    return false;
  }
}

// Sends the .pptx to the helper and returns the converted deck, or null.
async function convertWithHelper(file) {
  if (/\.key$/i.test(file.name)) {
    toast('Keynote は、PowerPoint 形式（.pptx）で書き出してから選んでください', 'error');
    return null;
  }
  if (/\.ppt$/i.test(file.name)) {
    toast('古い形式（.ppt）です。PowerPoint で .pptx として保存し直してから選んでください', 'error');
    return null;
  }
  // Chrome can call the helper directly. Safari blocks https pages from calling
  // http://127.0.0.1, so there the helper's own small window does the sending.
  if (await helperAlive()) return convertDirect(file);
  return convertViaBridge(file);
}

function progressDialog(file, note) {
  const started = Date.now();
  const dlg = openDialog(`
    <form class="form converting">
      <h2>📥 変換しています…</h2>
      <p><b>${esc(file.name)}</b></p>
      <div class="progress"><span></span></div>
      <p class="mini muted">PowerPoint が開いて、クリックごとの画面を作ります（自動で閉じます）。スライドが多いと1〜2分かかります。<br>
      Mac から「PowerPoint を操作する」などの許可を求められたら「OK／許可」を選んでください。${note ? `<br>${note}` : ''}</p>
      <p class="mini muted" id="elapsed"></p>
    </form>`);
  const noCancel = (e) => e.preventDefault();
  dlg.addEventListener('cancel', noCancel);
  const tick = setInterval(() => {
    const t = $('#elapsed', dlg);
    if (t) t.textContent = `${Math.round((Date.now() - started) / 1000)} 秒`;
  }, 1000);
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    clearInterval(tick);
    dlg.removeEventListener('cancel', noCancel);
    dlg.close();
  };
}

async function convertDirect(file) {
  const done = progressDialog(file);
  try {
    const res = await fetch(`${HELPER}/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) },
      body: file,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) throw new Error(j.error || `変換できませんでした (${res.status})`);
    return j.deck;
  } catch (err) {
    toast(err.message === 'Failed to fetch' ? '変換係との接続が切れました。もう一度試してください。' : err.message, 'error');
    return null;
  } finally {
    done();
  }
}

// Opens the helper's window (needs a click, or the browser blocks the pop-up), hands it the file
// with postMessage, and waits for the converted deck.
async function convertViaBridge(file) {
  const go = await new Promise((resolve) => {
    let ok = false;
    const dlg = openDialog(`
      <form class="form">
        <h2>📥 PowerPoint を変換します</h2>
        <p><b>${esc(file.name)}</b></p>
        <p class="mini muted">「変換を始める」を押すと、変換係の小さなウィンドウが開いて変換します（終わると自動で閉じます）。</p>
        <div class="actions">
          <button type="button" class="btn btn-ghost" data-close>キャンセル</button>
          <button class="btn btn-primary">▶ 変換を始める</button>
        </div>
      </form>`, { onSubmit: () => { ok = true; } });
    dlg.addEventListener('close', () => resolve(ok), { once: true });
  });
  if (!go) return null;
  // Opened right after the click (still counts as the user's action).
  const win = window.open(`${HELPER}/bridge`, 'aialt-helper', 'popup,width=440,height=300');
  if (!win) {
    toast('ポップアップがブロックされました。Safari の設定で、このサイトのポップアップを許可してください。', 'error');
    return null;
  }
  const buf = await file.arrayBuffer();
  const done = progressDialog(file, '変換係のウィンドウは閉じずにそのままにしてください。');
  let ready = false;
  let onMsg = null;
  let timer = 0;
  let closedCheck = 0;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('missing')), 8000);
      closedCheck = setInterval(() => {
        if (win.closed) reject(new Error('変換係のウィンドウが閉じられました。もう一度試してください。'));
      }, 1000);
      onMsg = (e) => {
        if (e.origin !== HELPER || e.source !== win) return;
        if (e.data?.type === 'aialt-ready' && !ready) {
          ready = true;
          clearTimeout(timer);
          win.postMessage({ type: 'aialt-convert', name: file.name, buf }, HELPER, [buf]);
        } else if (e.data?.type === 'aialt-result') {
          if (e.data.ok) resolve(e.data.deck);
          else reject(new Error(e.data.error || '変換できませんでした'));
        }
      };
      window.addEventListener('message', onMsg);
    });
  } catch (err) {
    if (err.message === 'missing') {
      try { win.close(); } catch {}
      done();
      helperMissing(file);
    } else {
      toast(err.message, 'error');
    }
    return null;
  } finally {
    clearTimeout(timer);
    clearInterval(closedCheck);
    window.removeEventListener('message', onMsg);
    done();
  }
}

function helperMissing(file) {
  openDialog(`
    <form class="form">
      <h2>📥 変換係が見つかりません</h2>
      <p>PowerPoint を自動で変換するには、このMacに「変換係」が必要です（最初の1回だけ）。</p>
      <ol class="steps-list">
        <li>Finder で <b>名桜大学公募 › AI-ALT › tools</b> を開く</li>
        <li><b>変換係をインストール.command</b> をダブルクリック（「開発元が未確認」と出たら、右クリック →「開く」）</li>
        <li>「インストールしました」と出たら、もう一度 <b>${esc(file.name)}</b> を選ぶ</li>
      </ol>
      <p class="mini muted">インストール済みなのにこの画面が出るときは、Chrome で開いてください。ブラウザに「ローカルネットワーク上のデバイスへのアクセス」を聞かれたら「許可」を選びます。<br>
      変換係を使わない場合は、<b>スライドを変換.command</b> で変換し、できた <b>.aialt-slides.json</b> を選んでも読み込めます。</p>
      <div class="actions"><button class="btn btn-primary">OK</button></div>
    </form>`);
}

// One made-here slide as it appears on the display (also used by the classroom).
export function slideView(s) {
  if (s.deck) return `<div class="slide image-only"><figure><img src="${s.deck.steps[s.deck.steps.length - 1]}" alt=""></figure></div>`;
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

export function levelButtons(cur) {
  const on = levelKey(cur);
  return LEVEL_KEYS.map((k) => `<button type="button" class="lv ${k === on ? 'on' : ''}" data-cefr="${k}" title="${LEVELS[k].ja}"><b>${k}</b><small>${LEVELS[k].ja}</small></button>`).join('');
}
