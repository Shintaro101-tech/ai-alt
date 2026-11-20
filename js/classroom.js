// Classroom: the ALT on the left, the display on the right.
// The display has three tabs: the slides, the ALT's board (what the ALT puts up while
// talking) and a live script. Slides move like PowerPoint (click, arrow keys, Space,
// Page Up/Down — a presentation remote sends these too), and "スライドだけ全画面"
// shows only the slides.

import { ALTS, avatarHTML, altKey, createMeter } from './avatars.js';
import { getLesson, saveLesson } from './store.js';
import { LEVELS, levelKey, PACES, PACE_KEYS, paceKey, paceText } from './levels.js';
import { levelButtons } from './editor.js';
import { SoundPlayer } from './sound.js';
import { openDeviceCheck, volume, volumeMuted, setVolume, setVolumeMuted } from './devices.js';
import { VISUAL_KINDS, normalizeVisual, normalizeSketch, visualHTML, visualSummary, pictureHTML, findPicture, illustrationHTML, animateDrawing } from './visuals.js';
import { ensurePasscode, relayPost } from './api.js';
import { LiveSession } from './live.js';
import { slideView } from './editor.js';
import { Stage, preload } from './deck.js';
import { $, $$, esc, toast, openDialog } from './util.js';

const QUICK = [
  { label: '💡 このスライドを説明', say: 'Please explain the slide that is on the display now to the class, briefly and simply.' },
  { label: '✍️ 例文をボードに', say: "Give the class one or two natural example sentences using the key language on the current slide. Say them, and write them on your board." },
  { label: '❓ クラスに質問', say: 'Ask the class one simple question about the current slide, then wait for an answer.' },
  { label: '🔁 もう一度ゆっくり', say: 'Please say what you just said again, a little more slowly.' },
];

export async function renderClass(el, id) {
  const lesson = await getLesson(id);
  if (!lesson) { location.hash = '#/'; return; }
  el.className = 'classroom';

  const state = {
    alt: altKey(lesson.alt),
    slide: 0,
    step: 0,
    tab: 'slides', // 'slides' | 'board' | 'script'
    board: [], // cards the ALT put up, newest first
    unseen: false,
    turns: [], // { role: 'class' | 'alt', text }
    status: 'idle', // idle | connecting | live | ended
    muted: false,
    present: false, // slides only, full screen
    blank: '', // '' | 'black' | 'white'
    pop: false, // in present mode: the newest board card shown over the slide
    jump: '', // typed slide number (then Enter), like PowerPoint
    cefr: levelKey(lesson.cefr), // students' English level
    pace: paceKey(lesson.pace), // the ALT's speaking speed
  };
  let live = null;
  const sounds = new SoundPlayer(() => onSoundChange());
  const pictures = () => (Array.isArray(lesson.pictures) ? lesson.pictures : []);
  let meter = null;
  let stage = null;
  let slideTimer = 0;
  let clock = 0;
  let startedAt = 0;

  el.innerHTML = `
    <header class="class-bar">
      <a class="bar-btn" href="#/" title="レッスン一覧">←</a>
      <div class="class-title"><span class="logo sm">AI</span>${esc(lesson.title)}</div>
      <div class="row">
        <span class="timer" id="timer"></span>
        <a class="bar-btn" href="#/edit/${encodeURIComponent(lesson.id)}">✏️ 編集</a>
        <button class="bar-btn" id="full" title="画面全体を全画面に">⛶ 全画面</button>
      </div>
    </header>
    <main class="class-main">
      <section class="alt-panel">
        <div class="alt-stage" id="altBox"></div>
        <div class="alt-name" id="altName"></div>
        <div class="alt-controls" id="controls"></div>
        <div class="alt-volume" id="vol"></div>
        <div class="alt-pick" id="pick"></div>
        <div class="class-level">
          <div class="class-level-title">学生の英語レベル <small id="lvDesc"></small></div>
          <div class="level-row compact" id="cefr"></div>
          <div class="class-level-title">話す速さ</div>
          <div class="level-row compact" id="pace"></div>
        </div>
        <div class="ask" id="ask">
          <div class="ask-title">ALTにお願い <small>（声に出さずに伝わります）</small></div>
          <div class="chips">${QUICK.map((q, i) => `<button class="chip" data-quick="${i}">${q.label}</button>`).join('')}</div>
          <form class="whisper" id="whisper" autocomplete="off">
            <input name="w" placeholder="例：Explain the difference between was and were." aria-label="ALTへの指示">
            <button class="btn btn-primary btn-sm">送る</button>
          </form>
          <p class="mini muted ask-hint">声で聞くときは「${ALTS[state.alt].name}, …」と名前を呼んでください。</p>
        </div>
      </section>
      <section class="display">
        <div class="display-head">
          <div class="display-tabs" id="tabs"></div>
          <button class="btn btn-ghost btn-sm" id="present" title="スライドだけを全画面に（F5）">🖥 <span class="lbl-long">スライドだけ</span>全画面</button>
        </div>
        <div class="screen" id="screen"></div>
        <div class="display-nav" id="nav"></div>
      </section>
    </main>
    <div class="present-ui">
      <div class="present-status" id="pstatus"></div>
      <div class="present-tools">
        <button type="button" id="pAlt" title="ALTを小さく表示（A）">🙂</button>
        <button type="button" id="pAsk" title="ALTにお願い（Q）">💬</button>
        <button type="button" id="pExit" title="全画面をやめる（Esc）">✕</button>
      </div>
      <form class="present-ask hide" id="pask" autocomplete="off">
        <input name="w" placeholder="ALTへのお願い（Enterで送る・Escで閉じる）">
      </form>
    </div>`;

  // ------------------------------------------------------------------ level
  function drawLevel() {
    $('#cefr', el).innerHTML = levelButtons(state.cefr);
    $('#lvDesc', el).textContent = `${state.cefr}：${LEVELS[state.cefr].ja}`;
    $('#pace', el).innerHTML = PACE_KEYS.map((k) => `<button type="button" class="lv ${k === state.pace ? 'on' : ''}" data-pace="${k}"><b>${PACES[k].ja}</b></button>`).join('');
  }
  $('#pace', el).onclick = (e) => {
    const b = e.target.closest('[data-pace]');
    if (!b || b.dataset.pace === state.pace) return;
    state.pace = lesson.pace = b.dataset.pace;
    drawLevel();
    saveLesson(lesson).catch(() => {});
    if (live) {
      note(`[Teacher's private note — the class did not hear this; never read it aloud or mention it] Change your speaking speed now. ${paceText(state.cefr, state.pace)} Don't say anything about this change; just use it from your next turn.`);
      toast(`ALTの話す速さを「${PACES[state.pace].ja.replace('🐢 ', '')}」にしました`);
    }
  };
  $('#cefr', el).onclick = (e) => {
    const b = e.target.closest('[data-cefr]');
    if (!b || b.dataset.cefr === state.cefr) return;
    state.cefr = lesson.cefr = b.dataset.cefr;
    drawLevel();
    saveLesson(lesson).catch(() => {});
    if (live) {
      note(`[Teacher's private note — the class did not hear this; never read it aloud or mention it] The students' English level is now ${state.cefr}. From now on: ${LEVELS[state.cefr].guide} ${paceText(state.cefr, state.pace)} Don't say anything about this change; just use it from your next turn.`);
      toast(`ALTの話し方を ${state.cefr} に変えました`);
    }
  };
  drawLevel();

  // ------------------------------------------------------------------ ALT panel
  function drawAlt() {
    $('#altBox', el).innerHTML = `${avatarHTML(state.alt)}<div class="alt-drawing" aria-hidden="true"><span>✏️</span></div>`;
    drawName();
    const busy = state.status === 'live' || state.status === 'connecting';
    $('#pick', el).innerHTML = busy ? '' : Object.entries(ALTS).map(([k, x]) => `
      <button class="pick ${k === state.alt ? 'on' : ''}" data-alt="${k}" title="${x.name}">${avatarHTML(k, { framing: 'face' })}</button>`).join('');
    $$('[data-alt]', el).forEach((b) => (b.onclick = () => {
      state.alt = b.dataset.alt;
      $('.ask-hint', el).textContent = `声で聞くときは「${ALTS[state.alt].name}, …」と名前を呼んでください。`;
      drawAlt();
    }));
  }
  function drawName() {
    const a = ALTS[state.alt];
    const pill = {
      idle: '<span class="pill">待機中</span>',
      connecting: '<span class="pill wait">接続中…</span>',
      live: state.muted ? '<span class="pill mute">マイクOFF</span>' : '<span class="pill on">● 聞いています</span>',
      ended: '<span class="pill">休憩中</span>',
    }[state.status];
    $('#altName', el).innerHTML = `<b>${a.name}</b><span>${a.flag}</span>${pill}`;
    const ps = $('#pstatus', el);
    ps.innerHTML = state.status === 'live'
      ? `<span class="dot-live ${state.muted ? 'off' : ''}"></span>${a.name} ${state.muted ? 'マイクOFF' : ''}${sounds.playing ? ' ♪' : ''}`
      : (sounds.playing ? '♪' : '');
  }
  function drawControls() {
    const c = $('#controls', el);
    if (state.status === 'live') {
      c.innerHTML = `
        <button class="btn mic ${state.muted ? 'off' : ''}" id="mic" title="マイクのオン・オフ（M）">${state.muted ? '🔇 マイクOFF' : '🎙 マイクON'}</button>
        <button class="btn btn-ghost" id="stop">⏹ 終了</button>`;
      $('#mic', el).onclick = toggleMic;
      $('#stop', el).onclick = () => stop();
      c.insertAdjacentHTML('beforeend', '<button class="btn btn-ghost btn-sm dev-btn wide" id="devices" title="授業中でも ALT との接続を切らずに切り替えられます">🎧 マイク・スピーカー</button>');
    } else if (state.status === 'connecting') {
      c.innerHTML = '<button class="btn btn-primary" disabled>接続中…</button>';
    } else {
      c.innerHTML = `<button class="btn btn-primary big" id="start">${state.turns.length ? '▶ 再開する' : `▶ ${ALTS[state.alt].name} を呼ぶ`}</button>`;
      $('#start', el).onclick = () => start();
      c.insertAdjacentHTML('beforeend', '<button class="btn btn-ghost btn-sm dev-btn wide" id="devices">🎧 マイク・スピーカーの確認</button>');
    }
    const dev = $('#devices', el);
    if (dev) dev.onclick = checkDevices;
    $('#ask', el).classList.toggle('off', state.status !== 'live');
  }

  // ------------------------------------------------------------------ display
  const cur = () => lesson.slides[state.slide];
  const stepsOf = (s) => (s?.deck ? s.deck.steps.length : 1);

  function drawTabs() {
    $('#tabs', el).innerHTML = `
      <button class="dtab ${state.tab === 'slides' ? 'on' : ''}" data-tab="slides">📑 スライド <small>${state.slide + 1}/${lesson.slides.length}</small></button>
      <button class="dtab ${state.tab === 'board' ? 'on' : ''} ${state.unseen ? 'glow' : ''}" data-tab="board">✍️ ALTボード${state.board.length ? ` <small>${state.board.length}</small>` : ''}${state.unseen ? '<span class="new">NEW</span>' : ''}</button>
      <button class="dtab ${state.tab === 'script' ? 'on' : ''}" data-tab="script">💬 スクリプト</button>`;
    $$('[data-tab]', el).forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
  }
  function setTab(tab) {
    state.tab = tab;
    if (tab === 'board') state.unseen = false;
    drawDisplay();
  }

  // Draws the whole display (tabs, screen, navigation) for the current state.
  function drawDisplay() {
    drawTabs();
    const screen = $('#screen', el);
    const nav = $('#nav', el);
    screen.dataset.tab = state.tab;
    stage = null;
    if (state.tab === 'slides') {
      const s = cur();
      screen.classList.toggle('dark', Boolean(s.deck));
      if (s.deck) {
        screen.innerHTML = '<div class="stage-wrap"><div id="stage"></div></div>';
        stage = new Stage($('#stage', el), s.deck.aspect || 16 / 9);
        stage.show(s.deck.steps[state.step]);
        preload(s);
        preload(lesson.slides[state.slide + 1]);
      } else {
        screen.innerHTML = `<div class="slide-frame"><div class="slide-box">${slideView(s)}</div></div>`;
      }
      if (state.pop && state.board[0]) screen.insertAdjacentHTML('beforeend', `<div class="board-pop">${cardHTML(state.board[0], true)}</div>`);
      if (state.blank) screen.insertAdjacentHTML('beforeend', `<div class="blank ${state.blank}"></div>`);
      drawNav();
    } else if (state.tab === 'board') {
      screen.classList.remove('dark');
      screen.innerHTML = state.board.length
        ? `<div class="board">${state.board.map((c, i) => cardHTML(c, i === 0)).join('')}</div>`
        : `<div class="screen-empty"><p>ALTが会話の中で大事な表現や質問をここに書きます。</p>
           <p class="mini">「<b>Can you write it on the board?</b>」と頼むこともできます。</p></div>`;
      nav.innerHTML = `${pictures().length ? '<button class="btn btn-ghost btn-sm" id="picBtn">🖼 画像を出す</button>' : ''}${state.board.length ? '<button class="btn btn-ghost btn-sm" id="clear">ボードを消す</button>' : ''}`;
      $('#clear', el)?.addEventListener('click', () => { state.board = []; drawDisplay(); });
      $('#picBtn', el)?.addEventListener('click', pickPicture);
      $$('[data-save-illu]', el).forEach((b) => (b.onclick = () => saveIllustration(b.dataset.saveIllu)));
    } else {
      screen.classList.remove('dark');
      screen.innerHTML = `<div class="script" id="script">${scriptHTML()}</div>`;
      nav.innerHTML = '';
      const box = $('#script', el);
      box.scrollTop = box.scrollHeight;
    }
  }
  function drawNav() {
    const nav = $('#nav', el);
    const n = stepsOf(cur());
    nav.innerHTML = `
      <button class="nav-btn" id="prev" title="前へ（← / PageUp）">◀</button>
      <div class="dots">${lesson.slides.map((s, i) => `<button class="dot ${i === state.slide ? 'on' : ''}" data-go="${i}" title="${esc(s.title || `スライド ${i + 1}`)}">${i + 1}</button>`).join('')}</div>
      <button class="nav-btn" id="next" title="次へ（クリック / → / Space / PageDown）">▶</button>
      ${n > 1 ? `<span class="steps">クリック ${state.step}/${n - 1}</span>` : ''}
      <button class="btn btn-ghost btn-sm snd-stop ${sounds.playing ? '' : 'hide'}" id="sndStop" title="音を止める（S）">♪ 再生中 ⏹ 止める</button>`;
    $('#sndStop', el).onclick = (e) => { e.stopPropagation(); sounds.stopAll(); };
    $('#prev', el).onclick = prev;
    $('#next', el).onclick = next;
    $$('[data-go]', el).forEach((b) => (b.onclick = () => goSlide(+b.dataset.go)));
  }
  // Only the parts that change on a click (keeps the animation running).
  function refreshChrome() {
    drawTabs();
    drawNav();
  }

  function cardHTML(c, latest) {
    if (c.style === 'visual') return `<div class="card-b visual ${latest ? 'latest' : ''}">${c.heading ? `<h3>${esc(c.heading)}</h3>` : ''}${visualHTML(c.visual)}</div>`;
    if (c.style === 'illustration') {
      const save = c.status === 'done' && !c.saved ? `<button type="button" class="btn btn-ghost btn-sm illu-save" data-save-illu="${esc(c.id)}">📌 画像ライブラリに保存</button>` : '';
      return `<div class="card-b picture ${latest ? 'latest' : ''}">${c.heading ? `<h3>${esc(c.heading)}</h3>` : ''}${illustrationHTML(c)}${save}</div>`;
    }
    if (c.style === 'picture') return `<div class="card-b picture ${latest ? 'latest' : ''}">${c.heading ? `<h3>${esc(c.heading)}</h3>` : ''}${pictureHTML(pictures().find((p) => p.id === c.picture), c.caption)}</div>`;
    const items = c.items.map((it) => {
      if (c.style === 'vocabulary') return `<li><b>${esc(it.text)}</b>${it.note ? `<span>${esc(it.note)}</span>` : ''}</li>`;
      return `<li>${esc(it.text)}${it.note ? `<span>${esc(it.note)}</span>` : ''}</li>`;
    }).join('');
    return `<div class="card-b ${c.style} ${latest ? 'latest' : ''}"><h3>${esc(c.heading)}</h3>${c.style === 'questions' ? `<ol>${items}</ol>` : `<ul>${items}</ul>`}</div>`;
  }
  function scriptHTML() {
    if (!state.turns.length) return '<div class="screen-empty"><p>会話がここに文字で表示されます。</p></div>';
    const a = ALTS[state.alt];
    return state.turns.map((t) => `<p class="line ${t.role}"><b>${t.role === 'alt' ? a.name : 'Class'}</b>${esc(t.text)}</p>`).join('');
  }

  // ------------------------------------------------------------------ moving through the slides
  // A first press only clears a black/white screen, the board pop-up or the other tabs.
  function settle() {
    if (state.blank || state.pop || state.tab !== 'slides') {
      state.blank = '';
      state.pop = false;
      state.tab = 'slides';
      drawDisplay();
      return true;
    }
    return false;
  }

  function next() {
    if (settle()) return;
    const s = cur();
    if (state.step < stepsOf(s) - 1) {
      const from = s.deck.steps[state.step];
      state.step++;
      sounds.playAt(s, state.slide, state.step);
      if (stage) stage.play(from, s.deck.steps[state.step], s.deck.clicks[state.step - 1] || []);
      else drawDisplay();
      refreshChrome();
      tellSlide();
      return;
    }
    if (state.slide < lesson.slides.length - 1) moveTo(state.slide + 1, 0, true);
  }
  function prev() {
    if (settle()) return;
    if (state.step > 0) {
      state.step--;
      if (stage) stage.show(cur().deck.steps[state.step]);
      refreshChrome();
      return;
    }
    if (state.slide > 0) moveTo(state.slide - 1, stepsOf(lesson.slides[state.slide - 1]) - 1, false);
  }
  function goSlide(i, step = 0) {
    if (i < 0 || i >= lesson.slides.length) return;
    state.blank = '';
    state.pop = false;
    state.tab = 'slides';
    moveTo(i, step, false, true);
  }
  // forward: the next slide in order (plays its transition); enter: jumped to it (plays its sounds too).
  function moveTo(i, step, forward, enter = false) {
    sounds.arrive(i);
    if ((forward || enter) && step === 0) {
      sounds.transition(lesson.slides[i]);
      sounds.playAt(lesson.slides[i], i, 0);
    }
    const to = lesson.slides[i];
    const from = cur();
    // PowerPoint picture → PowerPoint picture: keep the stage and play the transition.
    if (forward && stage && from.deck && to.deck && (to.deck.aspect || 0) === (from.deck.aspect || 0)) {
      state.slide = i;
      state.step = step;
      stage.transition(to.deck.steps[step], to.deck.transition);
      preload(lesson.slides[i + 1]);
      refreshChrome();
    } else {
      state.slide = i;
      state.step = step;
      drawDisplay();
    }
    tellSlide();
  }

  // Tell the ALT (quietly) once the teacher has settled on a slide.
  function tellSlide() {
    clearTimeout(slideTimer);
    slideTimer = setTimeout(() => {
      const s = cur();
      const text = slideText(s).slice(0, 700);
      note(`[Display update — do not respond to this message] The display now shows slide ${state.slide + 1}${s.title ? ` ("${s.title}")` : ''}${stepsOf(s) > 1 ? `, after click ${state.step} of ${stepsOf(s) - 1}` : ''}.${text ? ` Text on this slide: ${text}` : ''} Stay silent now and wait for the teacher or students to speak to you. Reminder: speak slowly, at about the speed in your instructions.`);
    }, 1500);
  }

  // ------------------------------------------------------------------ the ALT session
  function note(content) {
    live?.send({ type: 'session.commentary.append', event_id: `n_${Date.now()}`, delegation_id: null, content });
  }
  function ask(text) {
    if (!live) { toast(`先に「${ALTS[state.alt].name} を呼ぶ」を押してください`); return false; }
    note(`[Teacher's private note — the class did not hear this; never read it aloud or mention it] ${text}`);
    toast('ALTに伝えました');
    return true;
  }

  function showOnBoard(args) {
    const items = (Array.isArray(args.items) ? args.items : [])
      .map((it) => (typeof it === 'string' ? { text: it } : it))
      .filter((it) => it?.text);
    if (!items.length) return { ok: false, error: 'nothing to show' };
    const style = ['questions', 'vocabulary', 'note'].includes(args.style) ? args.style : 'note';
    putOnBoard({ heading: args.heading || 'Note', style, items });
    return { ok: true, shown: true };
  }
  function showVisual(args) {
    const visual = normalizeVisual(args);
    if (!visual) return { ok: false, error: `Nothing to draw. kind must be one of ${VISUAL_KINDS.join(', ')}, with its data.` };
    putOnBoard({ heading: args.heading || '', style: 'visual', visual });
    return { ok: true, shown: true };
  }
  function showPicture(args) {
    const pic = findPicture(pictures(), args.name);
    if (!pic) return { ok: false, error: `No picture called "${args.name}". Available: ${pictures().map((p) => p.name).join(', ') || 'none'}.` };
    putOnBoard({ heading: args.heading || '', style: 'picture', picture: pic.id, caption: args.caption || '' });
    return { ok: true, shown: pic.name };
  }
  // The teacher shows a picture from the library (the ALT is told what is on the board).
  function pickPicture() {
    const dlg = openDialog(`
      <form class="form">
        <h2>🖼 ボードに画像を出す</h2>
        <div class="pics">${pictures().map((p) => `
          <button type="button" class="pic-edit" data-pic="${esc(p.id)}"><img src="${esc(p.src)}" alt=""><b>${esc(p.name)}</b></button>`).join('')}</div>
        <div class="actions"><button type="button" class="btn btn-ghost" data-close>閉じる</button></div>
      </form>`);
    dlg.querySelectorAll('[data-pic]').forEach((b) => (b.onclick = () => {
      const pic = pictures().find((p) => p.id === b.dataset.pic);
      dlg.close();
      if (!pic) return;
      putOnBoard({ heading: '', style: 'picture', picture: pic.id, caption: '' });
      if (live) note(`[Display update — do not respond to this message] The teacher put the picture "${pic.name}" on your board${pic.note ? ` (${pic.note})` : ''}.`);
    }));
  }
  function putOnBoard(card) {
    state.board.unshift(card);
    if (state.present) {
      // Over the slide; the next click or key closes it.
      state.pop = true;
      state.tab = 'slides';
    } else {
      state.tab = 'board';
    }
    state.unseen = false;
    drawDisplay();
    // The new card is drawn line by line, and the ALT "draws" while it appears.
    const ms = animateDrawing(newestCard());
    if (ms > 0) drawing(ms);
  }
  const newestCard = () => $('.board-pop .card-b', el) || $('#screen .board .card-b.latest', el);

  // The ALT holds a pen for a moment (or while an illustration is being made).
  let drawTimer = 0;
  function drawing(ms) {
    const box = $('#altBox', el);
    box.classList.add('drawing');
    clearTimeout(drawTimer);
    if (ms === Infinity) return;
    drawTimer = setTimeout(() => {
      if (!state.board.some((c) => c.status === 'pending')) box.classList.remove('drawing');
    }, ms);
  }
  function showSketch(args) {
    const visual = normalizeSketch(args);
    if (!visual) return { ok: false, error: 'Nothing to draw. Give shapes on a 400 x 300 canvas.' };
    putOnBoard({ heading: args.heading || '', style: 'visual', visual });
    return { ok: true, shown: true };
  }

  // A detailed picture from the image AI (about 30 seconds). The ALT asks the teacher first;
  // the picture appears on the board when it is ready, and the ALT is told.
  function makeIllustration(args) {
    const prompt = String(args.description || args.prompt || '').trim().slice(0, 800);
    if (!prompt) return { ok: false, error: 'Describe the picture.' };
    if (state.board.some((c) => c.status === 'pending')) return { ok: false, error: 'Another illustration is still being made. Wait for it first.' };
    const card = { id: `illu_${Date.now()}`, heading: args.heading || '', style: 'illustration', status: 'pending', prompt, caption: String(args.caption || ''), started: Date.now() };
    putOnBoard(card);
    drawing(Infinity);
    const tick = setInterval(() => {
      $$('[data-since]', el).forEach((x) => (x.textContent = `${Math.round((Date.now() - Number(x.dataset.since)) / 1000)} 秒`));
    }, 1000);
    const finish = (patch) => {
      clearInterval(tick);
      Object.assign(card, patch);
      $('#altBox', el)?.classList.remove('drawing');
      const onTop = state.board[0] === card && (state.tab === 'board' || state.pop);
      if (!onTop && card.status === 'done') state.unseen = state.tab !== 'board';
      drawDisplay();
      if (onTop) animateDrawing(newestCard());
    };
    relayPost('/illustrations', { prompt })
      .then(async (res) => {
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.src) throw new Error(j.error?.message || `HTTP ${res.status}`);
        finish({ status: 'done', src: j.src });
        if (live) note(`[Display update — do not respond to this message] The illustration is now on your board: ${prompt}. You can tell the class it's ready and talk about it.`);
      })
      .catch((err) => {
        finish({ status: 'error', error: err.message });
        toast(`イラストを作れませんでした：${err.message}`, 'error');
        if (live) note("[Teacher's private note — the class did not hear this; never read it aloud or mention it] The illustration could not be made. Apologise briefly and, if it helps, draw a quick sketch instead.");
      });
    return { ok: true, status: 'started', note: 'It will appear on the board in about 30 seconds. Tell the class it is coming; you can keep talking meanwhile.' };
  }
  // An illustration worth keeping goes into the lesson's picture library.
  function saveIllustration(id) {
    const card = state.board.find((c) => c.id === id);
    if (!card?.src) return;
    lesson.pictures = Array.isArray(lesson.pictures) ? lesson.pictures : [];
    const name = (card.caption || card.prompt).replace(/[.。]$/, '').split(' ').slice(0, 6).join(' ');
    lesson.pictures.push({ id: `pic_${Date.now()}`, name, note: card.prompt, src: card.src });
    card.saved = true;
    saveLesson(lesson).then(() => toast('画像ライブラリに保存しました（名前は編集画面で変えられます）')).catch((e) => toast(e.message, 'error'));
    drawDisplay();
  }
  function showSlide(args) {
    const n = Math.round(Number(args.number));
    if (!(n >= 1 && n <= lesson.slides.length)) return { ok: false, error: `There are ${lesson.slides.length} slides.` };
    clearTimeout(slideTimer);
    state.blank = '';
    state.pop = false;
    state.tab = 'slides';
    state.slide = n - 1;
    state.step = stepsOf(cur()) - 1;
    drawDisplay();
    return { ok: true, showing: n };
  }

  function addTranscript(role, delta) {
    if (!delta) return;
    let last = state.turns[state.turns.length - 1];
    if (!last || last.role !== role) {
      last = { role, text: '' };
      state.turns.push(last);
    }
    last.text += delta;
    if (state.tab === 'script') {
      const box = $('#script', el);
      const stick = box && box.scrollHeight - box.scrollTop - box.clientHeight < 80;
      if (box) { box.innerHTML = scriptHTML(); if (stick) box.scrollTop = box.scrollHeight; }
    }
  }

  async function start() {
    if (!(await ensurePasscode())) return;
    const resume = state.turns.length > 0;
    state.status = 'connecting';
    drawAlt();
    drawControls();

    let instructions = buildInstructions(lesson, state);
    let cue = "[Display update — do not respond to this message] The lesson has started. Don't say anything yet. Wait silently until the teacher speaks to you, then respond to exactly what they said.";
    if (resume) {
      const transcript = state.turns.map((t) => `${t.role === 'alt' ? 'You' : 'Class'}: ${t.text}`).join('\n').slice(-8000);
      const shown = state.board.map((c) => `${c.heading ? `${c.heading}: ` : ''}${
        c.style === 'visual' ? visualSummary(c.visual)
        : c.style === 'picture' ? `picture "${pictures().find((p) => p.id === c.picture)?.name || ''}"`
        : c.style === 'illustration' ? `illustration: ${c.prompt}`
        : c.items.map((i) => i.text).join(' | ')}`).join('\n');
      instructions += `\n\nRESUMED LESSON
You were away for a moment and the teacher has called you back. Don't start over or introduce yourself again. The conversation so far:
${transcript}${shown ? `\nAlready on your board:\n${shown}` : ''}`;
      cue = "[Display update — do not respond to this message] You are back in the classroom. Don't say anything yet. Wait silently until the teacher speaks to you again, then continue naturally from where you left off.";
    }

    meter = createMeter();
    live = new LiveSession({
      session: {
        model: 'gpt-live-1',
        instructions,
        audio: { output: { voice: ALTS[state.alt].voice } },
        delegation: {
          type: 'responses',
          responses: {
            instructions: BACKEND_INSTRUCTIONS,
            tools: [BOARD_TOOL, VISUAL_TOOL, SKETCH_TOOL, ILLUSTRATION_TOOL, ...(pictures().length ? [PICTURE_TOOL] : []), SLIDE_TOOL],
            tool_choice: 'auto',
            parallel_tool_calls: false,
          },
        },
      },
      onStatus: (st) => {
        if (st === 'live' && state.status !== 'live') {
          state.status = 'live';
          state.muted = false;
          startedAt = Date.now();
          clearInterval(clock);
          clock = setInterval(tickClock, 1000);
          tickClock();
          note(cue);
          drawAlt();
          drawControls();
          onSoundChange();
          return;
        }
        if (st === 'lost') { toast('接続が切れました。もう一度呼んでください。', 'error'); stop(); }
      },
      onRemoteStream: (stream) => meter.attach(stream, $('#altBox', el)),
      onEvent: (ev) => {
        if (ev.type === 'session.input_transcript.delta') addTranscript('class', ev.delta);
        else if (ev.type === 'session.output_transcript.delta') addTranscript('alt', ev.delta);
        else if (ev.type === 'error') {
          console.warn('GPT-Live error', ev);
          toast(`エラー: ${ev.error?.message || '不明なエラー'}`, 'error');
        }
      },
      onFunctionCall: (fn, args) => {
        if (fn === 'show_on_board') return showOnBoard(args);
        if (fn === 'show_visual') return showVisual(args);
        if (fn === 'show_picture') return showPicture(args);
        if (fn === 'draw_sketch') return showSketch(args);
        if (fn === 'make_illustration') return makeIllustration(args);
        if (fn === 'show_slide') return showSlide(args);
        return { ok: false, error: 'unknown function' };
      },
    });

    try {
      await live.start();
    } catch (err) {
      console.error(err);
      toast(err.name === 'NotAllowedError' ? 'マイクの使用が許可されていません。ブラウザの設定を確認してください。' : err.message, 'error');
      meter?.stop();
      meter = null;
      live = null;
      state.status = resume ? 'ended' : 'idle';
      drawAlt();
      drawControls();
    }
  }

  // Before the lesson (or during it): choose and test the microphone and speaker.
  function checkDevices() {
    openDeviceCheck({
      onChange: (kind) => {
        if (kind === 'mic' && live) {
          live.switchMic().then(() => toast('マイクを切り替えました'), () => toast('マイクを切り替えられませんでした', 'error'));
        }
      },
    });
  }

  async function stop() {
    const s = live;
    live = null;
    clearInterval(clock);
    meter?.stop();
    meter = null;
    state.status = 'ended';
    drawAlt();
    drawControls();
    await s?.close().catch(() => {});
  }

  // While music from a slide plays, the classroom microphone is turned off (the ALT would hear it).
  function onSoundChange() {
    $('#sndStop', el)?.classList.toggle('hide', !sounds.playing);
    $('#pstatus', el) && drawName();
    if (!live || state.status !== 'live') return;
    if (sounds.playing && !state.muted) {
      state.muted = true;
      state.autoMuted = true;
      live.setMuted(true);
      drawName();
      drawControls();
      toast('音楽の再生中はマイクをOFFにします');
    } else if (!sounds.playing && state.autoMuted) {
      state.autoMuted = false;
      if (state.muted) {
        state.muted = false;
        live.setMuted(false);
        drawName();
        drawControls();
        toast('マイクをONに戻しました');
      }
    }
  }

  function toggleMic() {
    if (!live) return;
    state.autoMuted = false;
    state.muted = !state.muted;
    live.setMuted(state.muted);
    drawName();
    drawControls();
    toast(state.muted ? 'マイクOFF' : 'マイクON');
  }

  function tickClock() {
    const sec = Math.floor((Date.now() - startedAt) / 1000);
    $('#timer', el).textContent = `⏱ ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }

  // ------------------------------------------------------------------ asking the ALT
  $('#whisper', el).onsubmit = (e) => {
    e.preventDefault();
    const input = e.target.elements.w;
    const text = input.value.trim();
    if (text && ask(text)) input.value = '';
  };
  $$('[data-quick]', el).forEach((b) => (b.onclick = () => ask(QUICK[+b.dataset.quick].say)));
  // In slides-only mode: Q (or /) opens a small box at the bottom.
  const pask = $('#pask', el);
  function openPresentAsk() {
    pask.classList.remove('hide');
    pask.elements.w.focus();
  }
  pask.onsubmit = (e) => {
    e.preventDefault();
    const text = pask.elements.w.value.trim();
    if (text && ask(text)) pask.elements.w.value = '';
    pask.classList.add('hide');
    pask.elements.w.blur();
  };
  pask.elements.w.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); pask.classList.add('hide'); pask.elements.w.blur(); }
  });

  // ------------------------------------------------------------------ full screen
  function setPresent(on) {
    state.present = on;
    el.classList.toggle('present', on);
    if (on) {
      state.tab = 'slides';
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      state.pop = false;
      pask.classList.add('hide');
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
    drawDisplay();
  }
  $('#present', el).onclick = () => setPresent(true);
  if (!document.fullscreenEnabled) $('#full', el).classList.add('hide');
  $('#full', el).onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };
  const onFull = () => { if (!document.fullscreenElement && state.present) setPresent(false); };
  document.addEventListener('fullscreenchange', onFull);

  // Buttons for touch screens while presenting (no keyboard).
  $('#pExit', el).onclick = () => setPresent(false);
  $('#pAsk', el).onclick = () => openPresentAsk();
  $('#pAlt', el).onclick = () => el.classList.toggle('show-alt');

  // Clicking (tapping) the slide moves on, like PowerPoint; swiping goes forward or back.
  let swipe = null;
  let swiped = false;
  const screenEl = $('#screen', el);
  screenEl.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    swipe = e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
  }, { passive: true });
  screenEl.addEventListener('touchend', (e) => {
    if (!swipe || state.tab !== 'slides') return;
    const t = e.changedTouches[0];
    const dx = t.clientX - swipe.x;
    const dy = t.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      swiped = true;
      setTimeout(() => { swiped = false; }, 400);
      if (dx < 0) next(); else prev();
    }
  }, { passive: true });
  screenEl.addEventListener('click', (e) => {
    if (swiped || state.tab !== 'slides' || e.target.closest('button, a, input')) return;
    next();
  });

  // ------------------------------------------------------------------ volume
  // The app's own volume (ALT's voice + slide sounds). The loudest setting is the computer's volume.
  function drawVolume() {
    const box = $('#vol', el);
    const muted = volumeMuted();
    const v = volume();
    const icon = muted || v === 0 ? '🔇' : v < 40 ? '🔈' : v < 75 ? '🔉' : '🔊';
    box.innerHTML = `
      <button class="vol-mute" id="volMute" title="${muted ? '音を出す' : '消音'}（0 キー）">${icon}</button>
      <input type="range" id="volRange" min="0" max="100" step="5" value="${muted ? 0 : v}" aria-label="音量" title="音量（− / + キー）">
      <span class="vol-num" id="volNum">${muted ? '消音' : v + '%'}</span>`;
    $('#volMute', el).onclick = () => { setVolumeMuted(!volumeMuted()); drawVolume(); };
    const range = $('#volRange', el);
    range.oninput = () => {
      setVolume(Number(range.value));
      $('#volNum', el).textContent = `${range.value}%`;
      $('#volMute', el).textContent = range.value === '0' ? '🔇' : range.value < 40 ? '🔈' : range.value < 75 ? '🔉' : '🔊';
    };
    range.onchange = drawVolume;
  }
  function nudgeVolume(d) {
    const v = Math.max(0, Math.min(100, (volumeMuted() ? 0 : volume()) + d));
    if (v === 0) setVolumeMuted(true); else setVolume(v);
    drawVolume();
    toast(v === 0 ? '🔇 消音' : `音量 ${v}%`);
  }

  // ------------------------------------------------------------------ keys (PowerPoint-compatible)
  const onKey = (e) => {
    if (e.target.closest('input, textarea, select, dialog') || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === '0' && !state.jump) { setVolumeMuted(!volumeMuted()); drawVolume(); toast(volumeMuted() ? '🔇 消音' : `音量 ${volume()}%`); return; }
    if (/^[0-9]$/.test(k)) { state.jump += k; return; }
    if (['+', '=', ';'].includes(k)) { e.preventDefault(); nudgeVolume(10); return; }
    if (k === '-') { e.preventDefault(); nudgeVolume(-10); return; }
    if (k === 'Enter' && state.jump) {
      e.preventDefault();
      goSlide(Number(state.jump) - 1);
      state.jump = '';
      return;
    }
    state.jump = '';
    if (k === 'F5') {
      e.preventDefault();
      if (!e.shiftKey) goSlide(0);
      setPresent(true);
    } else if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n', 'N'].includes(k)) {
      e.preventDefault();
      next();
    } else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'].includes(k)) {
      e.preventDefault();
      prev();
    } else if (k === 'Home') goSlide(0);
    else if (k === 'End') goSlide(lesson.slides.length - 1);
    else if (['b', 'B', '.'].includes(k)) { state.blank = state.blank === 'black' ? '' : 'black'; state.tab = 'slides'; drawDisplay(); }
    else if (['w', 'W', ','].includes(k)) { state.blank = state.blank === 'white' ? '' : 'white'; state.tab = 'slides'; drawDisplay(); }
    else if (k === 'Escape' && state.present) setPresent(false);
    else if (k === 'm' || k === 'M') toggleMic();
    else if (k === 's' || k === 'S') sounds.stopAll();
    else if (k === 'a' || k === 'A') el.classList.toggle('show-alt');
    else if (k === 'q' || k === 'Q' || k === '/') {
      e.preventDefault();
      if (state.present) openPresentAsk();
      else $('#whisper', el).elements.w.focus();
    }
  };
  document.addEventListener('keydown', onKey);
  drawVolume();
  const onLeave = (e) => { if (live) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', onLeave);

  drawAlt();
  drawControls();
  drawDisplay();

  return () => {
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('fullscreenchange', onFull);
    window.removeEventListener('beforeunload', onLeave);
    clearTimeout(slideTimer);
    sounds.stopAll();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (live) stop();
  };
}

// ------------------------------------------------------------------ instructions

function slideText(s) {
  const text = s.deck ? s.deck.text : [s.title, s.body].filter(Boolean).join('\n');
  return (text || '').replace(/\*\*/g, '').replace(/\s*\n+\s*/g, ' / ').trim();
}

function buildInstructions(lesson, state) {
  const a = ALTS[state.alt];
  const pics = Array.isArray(lesson.pictures) ? lesson.pictures : [];
  // The level buttons decide the level; drop an old "CEFR A2–B1" from the free text.
  const about = (lesson.level || '').replace(/[,、]?\s*CEFR[\sA-C0-9+\-–~〜]*/gi, '').trim();
  const slides = lesson.slides.map((s, i) => {
    const text = slideText(s);
    return `Slide ${i + 1}${s.title ? ` (${s.title})` : ''}: ${text || '(picture only)'}${s.image ? ' [has a picture]' : ''}${s.note ? `\n  Note for you: ${s.note.replace(/\s*\n+\s*/g, ' ')}` : ''}`;
  }).join('\n');
  return `You are ${a.name}, an AI Assistant Language Teacher (AI-ALT) in an English class in Japan.
You are ${a.persona}
${a.accent}
${paceText(state.cefr, state.pace)}

THE CLASSROOM
You appear on a big screen at the front of the classroom, next to a display that everyone can see. A Japanese teacher of English leads the lesson and you support them, like a real ALT. Everything you hear comes from the classroom microphone: usually the teacher, sometimes a student.
${about ? `About the students: ${about}.
` : ''}THE STUDENTS' ENGLISH LEVEL (CEFR): ${LEVELS[state.cefr].guide}
${paceText(state.cefr, state.pace)}
Always speak at this level — your speed, words, grammar and turn length — even when the lesson plan gives you a script (keep its meaning and target grammar, but say it at this level). If the teacher tells you that the level has changed, switch at once.

HOW TO TALK
- Speak clear, natural English at the speed set by the students' level above, so the whole class can follow.
- Keep your turns as short as the students' level above says, unless the teacher asks for a longer answer, a model answer or a story, or the lesson plan gives you a script.
- The teacher leads. Follow the teacher's cues and don't start new activities by yourself. If you aren't sure what the teacher wants, ask briefly.
- Never speak first. At the start of the lesson, wait silently until the teacher talks to you, and respond to what they actually said: if they greet you or introduce you to the class, greet everyone back and introduce yourself briefly by name; if they ask you a question, answer it.
- Answer only when someone talks to you (they say your name, ask you a question, or the teacher turns to you). If speech is in Japanese or is clearly not addressed to you (students talking to each other, the teacher explaining in Japanese), stay silent.
- When a student talks to you, be warm and encouraging. If they make a mistake, recast it naturally ("Oh, you mean ...?") instead of correcting directly.
- Speak only English unless the teacher asks you to use Japanese.
- Messages that start with "[Teacher's private note" come from the teacher's keyboard: do what they ask right away, but never read them aloud or mention them.
- Messages that start with "[Display update" tell you what is on the display: don't respond to them, but use them when someone asks about the slide.

TODAY'S LESSON: ${lesson.title}
${lesson.plan ? `${lesson.plan}\n` : ''}
THE DISPLAY
The teacher's slides (you can't see pictures, only this text):
${slides}
The display is showing slide ${state.slide + 1} now.
You can change the display by delegating a request:
- to show slide N (only when the teacher asks you to, or when it clearly helps the teacher's activity);
- to write something on your board: a key expression, a model sentence, questions, a correction, or anything the teacher or a student asks you to write ("Can you write it on the board?"). Give the exact text to show.
- to draw a diagram or chart on your board when a picture makes an explanation clearer, or when the teacher asks ("Can you show it in a diagram?"). Say exactly what to draw and with which words or numbers. You can draw:
  * reality vs imagination — the real situation next to the imagined one, with the "distance" between them (great for conditionals and wishes);
  * a timeline — past / now / future, with real events on the line and imagined ones in dream bubbles (tenses, conditionals);
  * a bar chart or a line chart — numbers such as class survey results, prices or temperatures;
  * a table — comparisons or grammar patterns;
  * a Venn diagram — what two things have in common and how they differ;
  * steps — a process or the order of a story;
  * emoji picture cards — words with an emoji picture each (vocabulary, ideas).
${pics.length ? `- to show one of the teacher's pictures on your board (use the exact name):
${pics.map((p) => `  * "${p.name}"${p.note ? ` — ${p.note.replace(/\s*\n+\s*/g, ' ')}` : ''}`).join('\n')}
` : ''}- to SKETCH a simple picture on your board yourself, like a teacher drawing on a whiteboard: a house, a kitchen, a car, the weather, a stick figure, a map. It appears in a few seconds. Say what to draw and which words to label. Use it whenever a quick picture helps the class understand.
- to make a detailed AI ILLUSTRATION (a real, colourful picture). It takes about 30 seconds, so it is NOT your first choice:
  * Prefer a quick sketch, a diagram or one of the teacher's pictures.
  * Only when someone asks for a detailed or realistic picture, or a sketch really isn't enough, ASK FIRST: "It might take about 30 seconds. Do you want me to do it?" Then wait.
  * Delegate the illustration ONLY after the teacher clearly says yes, and describe the picture in detail. While it is being made, tell the class it's coming and keep the lesson going; you will be told when it is on the board.
IMPORTANT: the display only changes when you delegate. Whenever you say you'll write, draw or show something, delegate it in the same turn with the full content — never just say it. Keep board text short. Don't draw more than the moment needs: one clear diagram is better than several. You can say "I've put it on the board."`;
}

const BACKEND_INSTRUCTIONS = `You are the backend helper for AI-ALT, an AI assistant language teacher used in English classes in Japan. The voice ALT delegates display tasks to you. You have these functions:

show_on_board — write on the ALT's board, which the whole class can see. Use the exact content you were given and keep it concise.
  - style "questions": questions (one per item, no numbering — the app numbers them).
  - style "vocabulary": words or expressions. text = the English expression; note = a short Japanese meaning, optionally followed by " / " and a short English example.
  - style "note": anything else (a model sentence, a grammar pattern, a correction, a list, a spelling). For a correction, text = the better version and note = a short Japanese explanation.

show_visual — draw a diagram or chart on the board. Pick the kind that fits and fill in only its fields:
  - "reality": reality {text, note}, imagination {text, note}, gap_label (e.g. "past tense = distance"). For conditionals: reality "I have a small kitchen." / imagination "If I had a bigger kitchen, I would invite my friends."
  - "timeline": events [{text, time: past|now|future, real: true for facts, false for imagined}]
  - "bar_chart" / "line_chart": labels [...], series [{name, values [numbers]}], unit (optional, e.g. "%", "yen")
  - "table": columns [...], rows [[...], ...]
  - "venn": left {title, items}, right {title, items}, both [...]
  - "steps": items [{text, note, emoji}]
  - "emoji_cards": items [{emoji, text, note}] (one fitting emoji each)
  heading is optional and short; caption is an optional one-line explanation. Keep every label short (a few words).

show_picture — show one of the teacher's pictures by its exact name.

draw_sketch — draw a simple line picture yourself, like a teacher on a whiteboard (fast). Canvas: 400 wide x 300 high, (0,0) top left. Use 5–40 shapes:
  - {type:"line", x1,y1,x2,y2} · {type:"rect", x,y,w,h, rx} · {type:"circle", cx,cy,r} · {type:"ellipse", cx,cy,rx,ry}
  - {type:"polyline"|"polygon", points:[[x,y],...]} · {type:"path", d:"M ... C ... Z"} (plain SVG path commands only)
  - {type:"text", x,y, text, size} for short English labels (centred on x,y).
  Every shape may have color (black, navy, blue, red, orange, yellow, green, brown, pink, purple, gray, skyblue, white, or #hex), fill (a colour, or leave it out for none) and width (line thickness 2–8, default 4).
  Draw the main outlines first, then details, then labels. Keep it simple, clear and friendly, filling most of the canvas; leave room for the labels. Add a short caption if it helps.

make_illustration — a detailed AI illustration (takes about 30 seconds). Call it ONLY when the ALT's request says the teacher agreed to wait for it. description: a detailed English description of the picture (subject, setting, people, mood). Never ask for words or letters in the picture. caption: a short label.

show_slide — show one of the teacher's slides (1-based number).

Keep any text reply short and plain so it can be spoken aloud.`;

const BOARD_TOOL = {
  type: 'function',
  name: 'show_on_board',
  description: "Write on the ALT's board that the whole class can see (key expressions, model sentences, questions, corrections, or anything asked for).",
  parameters: {
    type: 'object',
    properties: {
      heading: { type: 'string', description: 'Short heading, e.g. "Key expression", "Questions", "Model answer".' },
      style: { type: 'string', enum: ['questions', 'vocabulary', 'note'] },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Main text.' },
            note: { type: 'string', description: 'Optional smaller text, e.g. Japanese meaning or explanation.' },
          },
          required: ['text'],
        },
      },
    },
    required: ['heading', 'style', 'items'],
  },
};

const VISUAL_TOOL = {
  type: 'function',
  name: 'show_visual',
  description: "Draw a diagram or chart on the ALT's board (reality vs imagination, timeline, bar/line chart, table, Venn diagram, steps, emoji picture cards).",
  parameters: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['reality', 'timeline', 'bar_chart', 'line_chart', 'table', 'venn', 'steps', 'emoji_cards'] },
      heading: { type: 'string', description: 'Optional short heading.' },
      caption: { type: 'string', description: 'Optional one-line explanation under the drawing.' },
      reality: { type: 'object', properties: { text: { type: 'string' }, note: { type: 'string' } }, description: 'reality: the real situation.' },
      imagination: { type: 'object', properties: { text: { type: 'string' }, note: { type: 'string' } }, description: 'reality: the imagined situation.' },
      gap_label: { type: 'string', description: 'reality: what the distance means, e.g. "past tense = distance from reality".' },
      events: {
        type: 'array',
        description: 'timeline: events.',
        items: { type: 'object', properties: { text: { type: 'string' }, time: { type: 'string', enum: ['past', 'now', 'future'] }, real: { type: 'boolean' } }, required: ['text', 'time'] },
      },
      labels: { type: 'array', items: { type: 'string' }, description: 'bar_chart / line_chart: category labels.' },
      series: {
        type: 'array',
        description: 'bar_chart / line_chart: one or more data series.',
        items: { type: 'object', properties: { name: { type: 'string' }, values: { type: 'array', items: { type: 'number' } } }, required: ['values'] },
      },
      unit: { type: 'string', description: 'bar_chart / line_chart: unit shown after numbers.' },
      columns: { type: 'array', items: { type: 'string' }, description: 'table: column headings.' },
      rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'table: rows of cells.' },
      left: { type: 'object', properties: { title: { type: 'string' }, items: { type: 'array', items: { type: 'string' } } }, description: 'venn: left circle.' },
      right: { type: 'object', properties: { title: { type: 'string' }, items: { type: 'array', items: { type: 'string' } } }, description: 'venn: right circle.' },
      both: { type: 'array', items: { type: 'string' }, description: 'venn: what both share.' },
      items: {
        type: 'array',
        description: 'steps / emoji_cards: the items.',
        items: { type: 'object', properties: { text: { type: 'string' }, note: { type: 'string' }, emoji: { type: 'string' } }, required: ['text'] },
      },
    },
    required: ['kind'],
  },
};

const SHAPE = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['line', 'rect', 'circle', 'ellipse', 'polyline', 'polygon', 'path', 'text'] },
    x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' },
    x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' },
    cx: { type: 'number' }, cy: { type: 'number' }, r: { type: 'number' }, rx: { type: 'number' }, ry: { type: 'number' },
    points: { type: 'array', items: { type: 'array', items: { type: 'number' } } },
    d: { type: 'string', description: 'SVG path data (path only).' },
    text: { type: 'string', description: 'Label (text only).' },
    size: { type: 'number', description: 'Font size (text only).' },
    color: { type: 'string' },
    fill: { type: 'string' },
    width: { type: 'number', description: 'Line thickness.' },
  },
  required: ['type'],
};

const SKETCH_TOOL = {
  type: 'function',
  name: 'draw_sketch',
  description: "Draw a simple line picture on the ALT's board, like a teacher on a whiteboard (appears in a few seconds). Canvas 400 x 300.",
  parameters: {
    type: 'object',
    properties: {
      heading: { type: 'string', description: 'Optional short heading.' },
      caption: { type: 'string', description: 'Optional one-line caption.' },
      shapes: { type: 'array', items: SHAPE, description: 'Shapes in drawing order.' },
    },
    required: ['shapes'],
  },
};

const ILLUSTRATION_TOOL = {
  type: 'function',
  name: 'make_illustration',
  description: 'Make a detailed AI illustration for the board (about 30 seconds). Only after the teacher agreed to wait.',
  parameters: {
    type: 'object',
    properties: {
      description: { type: 'string', description: 'Detailed English description of the picture. No words or letters in the picture.' },
      caption: { type: 'string', description: 'Short label shown under the picture.' },
      heading: { type: 'string', description: 'Optional short heading.' },
    },
    required: ['description'],
  },
};

const PICTURE_TOOL = {
  type: 'function',
  name: 'show_picture',
  description: "Show one of the teacher's pictures on the ALT's board.",
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The exact name of the picture.' },
      caption: { type: 'string', description: 'Optional short caption.' },
    },
    required: ['name'],
  },
};

const SLIDE_TOOL = {
  type: 'function',
  name: 'show_slide',
  description: "Show one of the teacher's slides on the display.",
  parameters: {
    type: 'object',
    properties: { number: { type: 'integer', description: 'Slide number, starting at 1.' } },
    required: ['number'],
  },
};
