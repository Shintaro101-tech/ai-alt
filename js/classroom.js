// Classroom: the ALT on the left, the display on the right.
// The display has three tabs: the teacher's slides, the ALT's board (what the ALT puts up
// while talking), and a live script of the conversation.

import { ALTS, avatarHTML, altKey, createMeter } from './avatars.js';
import { getLesson } from './store.js';
import { ensurePasscode } from './api.js';
import { LiveSession } from './live.js';
import { slideView } from './editor.js';
import { $, $$, esc, toast } from './util.js';

export async function renderClass(el, id) {
  const lesson = await getLesson(id);
  if (!lesson) { location.hash = '#/'; return; }
  el.className = 'classroom';

  const state = {
    alt: altKey(lesson.alt),
    slide: 0,
    tab: 'slides', // 'slides' | 'board' | 'script'
    board: [], // cards the ALT put up, newest first
    unseen: false,
    turns: [], // { role: 'class' | 'alt', text }
    status: 'idle', // idle | connecting | live | ended
    muted: false,
  };
  let live = null;
  let meter = null;
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
        <button class="bar-btn" id="full" title="全画面（F）">⛶ 全画面</button>
      </div>
    </header>
    <main class="class-main">
      <section class="alt-panel">
        <div class="alt-stage" id="altBox"></div>
        <div class="alt-name" id="altName"></div>
        <div class="alt-controls" id="controls"></div>
        <div class="alt-pick" id="pick"></div>
        <form class="whisper" id="whisper" autocomplete="off">
          <input name="w" placeholder="ALTへの指示（声に出しません）" aria-label="ALTへの指示">
          <button class="btn btn-ghost btn-sm" title="送る">送る</button>
        </form>
      </section>
      <section class="display">
        <div class="display-tabs" id="tabs"></div>
        <div class="screen" id="screen"></div>
        <div class="display-nav" id="nav"></div>
      </section>
    </main>`;

  // ------------------------------------------------------------------ ALT panel
  function drawAlt() {
    $('#altBox', el).innerHTML = avatarHTML(state.alt);
    drawName();
    const busy = state.status === 'live' || state.status === 'connecting';
    $('#pick', el).innerHTML = busy ? '' : Object.entries(ALTS).map(([k, x]) => `
      <button class="pick ${k === state.alt ? 'on' : ''}" data-alt="${k}" title="${x.name}">${avatarHTML(k, { framing: 'face' })}</button>`).join('');
    $$('[data-alt]', el).forEach((b) => (b.onclick = () => { state.alt = b.dataset.alt; drawAlt(); }));
  }
  function drawName() {
    const a = ALTS[state.alt];
    const pill = {
      idle: '<span class="pill">待機中</span>',
      connecting: '<span class="pill wait">接続中…</span>',
      live: state.muted ? '<span class="pill mute">マイクOFF</span>' : '<span class="pill on">● 聞いています</span>',
      ended: '<span class="pill">休憩中</span>',
    }[state.status];
    $('#altName', el).innerHTML = `<b>${a.name}</b><span>${a.flag} ALT</span>${pill}`;
  }
  function drawControls() {
    const c = $('#controls', el);
    if (state.status === 'live') {
      c.innerHTML = `
        <button class="btn mic ${state.muted ? 'off' : ''}" id="mic" title="マイクのオン・オフ（スペースキー）">${state.muted ? '🔇 マイクOFF' : '🎙 マイクON'}</button>
        <button class="btn btn-ghost" id="stop">⏹ 終了</button>`;
      $('#mic', el).onclick = toggleMic;
      $('#stop', el).onclick = () => stop();
    } else if (state.status === 'connecting') {
      c.innerHTML = '<button class="btn btn-primary" disabled>接続中…</button>';
    } else {
      c.innerHTML = `<button class="btn btn-primary big" id="start">${state.turns.length ? '▶ 再開する' : `▶ ${ALTS[state.alt].name} を呼ぶ`}</button>`;
      $('#start', el).onclick = () => start();
    }
    $('#whisper', el).classList.toggle('hide', state.status !== 'live');
  }

  // ------------------------------------------------------------------ display
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
  function drawDisplay() {
    drawTabs();
    const screen = $('#screen', el);
    const nav = $('#nav', el);
    screen.dataset.tab = state.tab;
    if (state.tab === 'slides') {
      screen.innerHTML = slideView(lesson.slides[state.slide]);
      nav.innerHTML = `
        <button class="nav-btn" id="prev" ${state.slide === 0 ? 'disabled' : ''} title="前へ（←）">◀</button>
        <div class="dots">${lesson.slides.map((s, i) => `<button class="dot ${i === state.slide ? 'on' : ''}" data-go="${i}" title="${esc(s.title || `スライド ${i + 1}`)}">${i + 1}</button>`).join('')}</div>
        <button class="nav-btn" id="next" ${state.slide === lesson.slides.length - 1 ? 'disabled' : ''} title="次へ（→）">▶</button>`;
      $('#prev', el).onclick = () => goSlide(state.slide - 1);
      $('#next', el).onclick = () => goSlide(state.slide + 1);
      $$('[data-go]', el).forEach((b) => (b.onclick = () => goSlide(+b.dataset.go)));
    } else if (state.tab === 'board') {
      screen.innerHTML = state.board.length
        ? `<div class="board">${state.board.map((c, i) => cardHTML(c, i === 0)).join('')}</div>`
        : `<div class="screen-empty"><p>ALTが会話の中で大事な表現や質問をここに書きます。</p>
           <p class="mini">「<b>Can you write it on the board?</b>」と頼むこともできます。</p></div>`;
      nav.innerHTML = state.board.length ? '<button class="btn btn-ghost btn-sm" id="clear">ボードを消す</button>' : '';
      $('#clear', el)?.addEventListener('click', () => { state.board = []; drawDisplay(); });
    } else {
      screen.innerHTML = `<div class="script" id="script">${scriptHTML()}</div>`;
      nav.innerHTML = '';
      const box = $('#script', el);
      box.scrollTop = box.scrollHeight;
    }
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

  function goSlide(i) {
    if (i < 0 || i >= lesson.slides.length) return;
    state.slide = i;
    state.tab = 'slides';
    drawDisplay();
    // Tell the ALT (quietly) once the teacher has settled on a slide.
    clearTimeout(slideTimer);
    slideTimer = setTimeout(() => {
      const s = lesson.slides[state.slide];
      note(`[Display update — do not respond to this message] The teacher has moved the display to slide ${state.slide + 1}${s.title ? `: "${s.title}"` : ''}. Stay silent now and wait for the teacher or students to speak to you.`);
    }, 1500);
  }

  // ------------------------------------------------------------------ the ALT session
  function note(content) {
    live?.send({ type: 'session.commentary.append', event_id: `n_${Date.now()}`, delegation_id: null, content });
  }

  function showOnBoard(args) {
    const items = (Array.isArray(args.items) ? args.items : [])
      .map((it) => (typeof it === 'string' ? { text: it } : it))
      .filter((it) => it?.text);
    if (!items.length) return { ok: false, error: 'nothing to show' };
    const style = ['questions', 'vocabulary', 'note'].includes(args.style) ? args.style : 'note';
    state.board.unshift({ heading: args.heading || 'Note', style, items });
    state.tab = 'board';
    state.unseen = false;
    drawDisplay();
    return { ok: true, shown: true };
  }
  function showSlide(args) {
    const n = Math.round(Number(args.number));
    if (!(n >= 1 && n <= lesson.slides.length)) return { ok: false, error: `There are ${lesson.slides.length} slides.` };
    clearTimeout(slideTimer);
    state.slide = n - 1;
    state.tab = 'slides';
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
  }

  function tickClock() {
    const sec = Math.floor((Date.now() - startedAt) / 1000);
    $('#timer', el).textContent = `⏱ ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }

  // ------------------------------------------------------------------ keys, whisper, fullscreen
  $('#whisper', el).onsubmit = (e) => {
    e.preventDefault();
    const input = e.target.elements.w;
    const text = input.value.trim();
    if (!text || !live) return;
    note(`[Teacher's private note — the class did not hear this; never read it aloud] ${text}`);
    input.value = '';
    toast('ALTに伝えました');
  };
  $('#full', el).onclick = toggleFull;
  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }
  const onKey = (e) => {
    if (e.target.closest('input, textarea, select, dialog') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); goSlide(state.slide + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); goSlide(state.slide - 1); }
    else if (e.key === ' ' && live) { e.preventDefault(); toggleMic(); }
    else if (e.key === 'f' || e.key === 'F') toggleFull();
  };
  document.addEventListener('keydown', onKey);
  const onLeave = (e) => { if (live) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', onLeave);

  drawAlt();
  drawControls();
  drawDisplay();

  return () => {
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('beforeunload', onLeave);
    clearTimeout(slideTimer);
    if (live) stop();
  };
}

// ------------------------------------------------------------------ instructions

function buildInstructions(lesson, state) {
  const a = ALTS[state.alt];
  const slides = lesson.slides.map((s, i) => {
    const text = [s.title, (s.body || '').replace(/\*\*/g, '').replace(/\n+/g, ' / ')].filter(Boolean).join(' — ');
    return `Slide ${i + 1}: ${text || '(picture only)'}${s.image ? ' [has a picture]' : ''}${s.note ? `\n  Note for you: ${s.note}` : ''}`;
  }).join('\n');
  return `You are ${a.name}, an AI Assistant Language Teacher (AI-ALT) in an English class in Japan.
You are ${a.persona}
${a.accent}

THE CLASSROOM
You appear on a big screen at the front of the classroom, next to a display that everyone can see. A Japanese teacher of English leads the lesson and you support them, like a real ALT. Everything you hear comes from the classroom microphone: usually the teacher, sometimes a student.
${lesson.level ? `The students: ${lesson.level}. Adjust your English to their level.` : 'Adjust your English to the students\' level.'}

HOW TO TALK
- Speak clear, natural English, a little slower than usual, so the whole class can follow.
- Keep your turns short (1-3 sentences), unless the teacher asks for a longer answer, a model answer or a story, or the lesson plan gives you a script.
- The teacher leads. Follow the teacher's cues and don't start new activities by yourself. If you aren't sure what the teacher wants, ask briefly.
- If speech is in Japanese or is clearly not addressed to you (students talking to each other, the teacher explaining in Japanese), stay silent.
- When a student talks to you, be warm and encouraging. If they make a mistake, recast it naturally ("Oh, you mean ...?") instead of correcting directly.
- Speak only English unless the teacher asks you to use Japanese.
- Messages that start with "[Teacher's private note" come from the teacher's keyboard: follow them, but never read them aloud or mention them.
- Messages that start with "[Display update" just tell you what is on the display: don't respond to them.

TODAY'S LESSON: ${lesson.title}
${lesson.plan ? `${lesson.plan}\n` : ''}
THE DISPLAY
The teacher's slides:
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
