// Classroom: the ALT on the left, the display on the right.
// The display has three tabs: the slides, the ALT's board (what the ALT puts up while
// talking) and a live script. Slides move like PowerPoint (click, arrow keys, Space,
// Page Up/Down — a presentation remote sends these too), and "スライドだけ全画面"
// shows only the slides.

import { ALTS, avatarHTML, altKey, createMeter } from './avatars.js';
import { getLesson } from './store.js';
import { ensurePasscode } from './api.js';
import { LiveSession } from './live.js';
import { slideView } from './editor.js';
import { Stage, preload } from './deck.js';
import { $, $$, esc, toast } from './util.js';

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
  };
  let live = null;
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
        <div class="alt-pick" id="pick"></div>
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
          <button class="btn btn-ghost btn-sm" id="present" title="スライドだけを全画面に（F5）">🖥 スライドだけ全画面</button>
        </div>
        <div class="screen" id="screen"></div>
        <div class="display-nav" id="nav"></div>
      </section>
    </main>
    <div class="present-ui">
      <div class="present-status" id="pstatus"></div>
      <form class="present-ask hide" id="pask" autocomplete="off">
        <input name="w" placeholder="ALTへのお願い（Enterで送る・Escで閉じる）">
      </form>
    </div>`;

  // ------------------------------------------------------------------ ALT panel
  function drawAlt() {
    $('#altBox', el).innerHTML = avatarHTML(state.alt);
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
      ? `<span class="dot-live ${state.muted ? 'off' : ''}"></span>${a.name} ${state.muted ? 'マイクOFF' : ''}`
      : '';
  }
  function drawControls() {
    const c = $('#controls', el);
    if (state.status === 'live') {
      c.innerHTML = `
        <button class="btn mic ${state.muted ? 'off' : ''}" id="mic" title="マイクのオン・オフ（M）">${state.muted ? '🔇 マイクOFF' : '🎙 マイクON'}</button>
        <button class="btn btn-ghost" id="stop">⏹ 終了</button>`;
      $('#mic', el).onclick = toggleMic;
      $('#stop', el).onclick = () => stop();
    } else if (state.status === 'connecting') {
      c.innerHTML = '<button class="btn btn-primary" disabled>接続中…</button>';
    } else {
      c.innerHTML = `<button class="btn btn-primary big" id="start">${state.turns.length ? '▶ 再開する' : `▶ ${ALTS[state.alt].name} を呼ぶ`}</button>`;
      $('#start', el).onclick = () => start();
    }
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
        screen.innerHTML = slideView(s);
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
      nav.innerHTML = state.board.length ? '<button class="btn btn-ghost btn-sm" id="clear">ボードを消す</button>' : '';
      $('#clear', el)?.addEventListener('click', () => { state.board = []; drawDisplay(); });
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
      ${n > 1 ? `<span class="steps">クリック ${state.step}/${n - 1}</span>` : ''}`;
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
    moveTo(i, step, false);
  }
  function moveTo(i, step, forward) {
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
      note(`[Display update — do not respond to this message] The display now shows slide ${state.slide + 1}${s.title ? ` ("${s.title}")` : ''}${stepsOf(s) > 1 ? `, after click ${state.step} of ${stepsOf(s) - 1}` : ''}.${text ? ` Text on this slide: ${text}` : ''} Stay silent now and wait for the teacher or students to speak to you.`);
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
    state.board.unshift({ heading: args.heading || 'Note', style, items });
    if (state.present) {
      // Over the slide; the next click or key closes it.
      state.pop = true;
      state.tab = 'slides';
    } else {
      state.tab = 'board';
    }
    state.unseen = false;
    drawDisplay();
    return { ok: true, shown: true };
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
    let cue = lesson.greet
      ? `Greet the class now in one or two short sentences and introduce yourself by name (for example "Hi everyone! I'm ${ALTS[state.alt].name}."). Then stop and wait for the teacher.`
      : 'Do not say anything yet. Wait silently until the teacher or a student speaks to you.';
    if (resume) {
      const transcript = state.turns.map((t) => `${t.role === 'alt' ? 'You' : 'Class'}: ${t.text}`).join('\n').slice(-8000);
      const shown = state.board.map((c) => `${c.heading}: ${c.items.map((i) => i.text).join(' | ')}`).join('\n');
      instructions += `\n\nRESUMED LESSON
You were away for a moment and the teacher has called you back. Don't start over or introduce yourself again. The conversation so far:
${transcript}${shown ? `\nAlready on your board:\n${shown}` : ''}`;
      cue = `Say "I'm back!" or something similar in a few words, then wait for the teacher.`;
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
            tools: [BOARD_TOOL, SLIDE_TOOL],
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

  function toggleMic() {
    if (!live) return;
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
  $('#full', el).onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };
  const onFull = () => { if (!document.fullscreenElement && state.present) setPresent(false); };
  document.addEventListener('fullscreenchange', onFull);

  // Clicking the slide moves on, like PowerPoint.
  $('#screen', el).addEventListener('click', (e) => {
    if (state.tab !== 'slides' || e.target.closest('button, a, input')) return;
    next();
  });

  // ------------------------------------------------------------------ keys (PowerPoint-compatible)
  const onKey = (e) => {
    if (e.target.closest('input, textarea, select, dialog') || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (/^[0-9]$/.test(k)) { state.jump += k; return; }
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
    else if (k === 'a' || k === 'A') el.classList.toggle('show-alt');
    else if (k === 'q' || k === 'Q' || k === '/') {
      e.preventDefault();
      if (state.present) openPresentAsk();
      else $('#whisper', el).elements.w.focus();
    }
  };
  document.addEventListener('keydown', onKey);
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
  const slides = lesson.slides.map((s, i) => {
    const text = slideText(s);
    return `Slide ${i + 1}${s.title ? ` (${s.title})` : ''}: ${text || '(picture only)'}${s.image ? ' [has a picture]' : ''}${s.note ? `\n  Note for you: ${s.note.replace(/\s*\n+\s*/g, ' ')}` : ''}`;
  }).join('\n');
  return `You are ${a.name}, an AI Assistant Language Teacher (AI-ALT) in an English class in Japan.
You are ${a.persona}
${a.accent}

THE CLASSROOM
You appear on a big screen at the front of the classroom, next to a display that everyone can see. A Japanese teacher of English leads the lesson and you support them, like a real ALT. Everything you hear comes from the classroom microphone: usually the teacher, sometimes a student.
${lesson.level ? `The students: ${lesson.level}. Adjust your English to their level.` : "Adjust your English to the students' level."}

HOW TO TALK
- Speak clear, natural English, a little slower than usual, so the whole class can follow.
- Keep your turns short (1-3 sentences), unless the teacher asks for a longer answer, a model answer or a story, or the lesson plan gives you a script.
- The teacher leads. Follow the teacher's cues and don't start new activities by yourself. If you aren't sure what the teacher wants, ask briefly.
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
IMPORTANT: the display only changes when you delegate. Whenever you say you'll write or show something, delegate it in the same turn with the full text — never just say it. Keep board text short. You can say "I've put it on the board."`;
}

const BACKEND_INSTRUCTIONS = `You are the backend helper for AI-ALT, an AI assistant language teacher used in English classes in Japan. The voice ALT delegates display tasks to you. You have two functions:

show_on_board — write on the ALT's board, which the whole class can see. Use the exact content you were given and keep it concise.
  - style "questions": questions (one per item, no numbering — the app numbers them).
  - style "vocabulary": words or expressions. text = the English expression; note = a short Japanese meaning, optionally followed by " / " and a short English example.
  - style "note": anything else (a model sentence, a grammar pattern, a correction, a list, a spelling). For a correction, text = the better version and note = a short Japanese explanation.

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
