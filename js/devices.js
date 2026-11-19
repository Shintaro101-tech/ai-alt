// Microphone and speaker: which ones to use (remembered on this computer) and a check before the lesson.
//
// - The microphone can be chosen in every browser.
// - The speaker can be chosen only where the browser supports it (Chrome / Edge). In Safari the
//   ALT's voice goes to the Mac's own sound output, so the check explains how to change that.

import { openDialog, onDialogClose, esc } from './util.js';

const KEY_MIC = 'aialt:mic';
const KEY_SPK = 'aialt:speaker';
const read = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const write = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} };

export const micId = () => read(KEY_MIC);
export const speakerId = () => read(KEY_SPK);
export const canPickSpeaker = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

const BASE = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

// The classroom microphone: the chosen one, or the computer's default if it is no longer there.
export async function openMic(id = micId()) {
  if (id) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { ...BASE, deviceId: { exact: id } } });
    } catch (err) {
      if (!['OverconstrainedError', 'NotFoundError'].includes(err.name)) throw err;
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio: BASE });
}

// Sends an <audio>/Audio element to the chosen speaker (where the browser allows it).
const outputs = new Set();
export function useSpeaker(audioEl) {
  if (!audioEl) return audioEl;
  outputs.add(audioEl);
  const id = speakerId();
  if (canPickSpeaker && id) audioEl.setSinkId(id).catch(() => {});
  return audioEl;
}
export function forgetSpeaker(audioEl) { outputs.delete(audioEl); }
function applySpeakerToAll() {
  const id = speakerId();
  if (!canPickSpeaker) return;
  for (const a of outputs) a.setSinkId(id || '').catch(() => {});
}

async function listDevices() {
  const all = await navigator.mediaDevices.enumerateDevices();
  return {
    mics: all.filter((d) => d.kind === 'audioinput'),
    speakers: all.filter((d) => d.kind === 'audiooutput'),
  };
}

const label = (d, i, kind) => d.label || `${kind} ${i + 1}`;

// A short two-note chime as a WAV file, so it can be played through the chosen speaker.
function chimeUrl() {
  const rate = 44100;
  const notes = [[659.25, 0, 0.45], [880, 0.28, 0.9]];
  const len = Math.round(rate * 1.0);
  const data = new Int16Array(len);
  for (const [f, start, end] of notes) {
    for (let i = Math.round(start * rate); i < Math.min(len, Math.round(end * rate)); i++) {
      const t = i / rate - start;
      const env = Math.min(1, t * 60) * Math.exp(-t * 4.5);
      data[i] += Math.round(Math.sin(2 * Math.PI * f * t) * env * 0.35 * 32767);
    }
  }
  const buf = new ArrayBuffer(44 + len * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, len * 2, true);
  new Int16Array(buf, 44).set(data);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

// The check: pick the microphone and speaker, watch the level, play a test sound, record and listen back.
// onChange(kind) is called when the teacher picks another device ('mic' or 'speaker').
export function openDeviceCheck({ onChange } = {}) {
  return new Promise((resolve) => {
    let stream = null;
    let ctx = null;
    let raf = 0;
    let rec = null;
    let closed = false;
    const players = new Set();
    const chime = chimeUrl();

    const dlg = openDialog(`
      <form class="form devcheck">
        <h2>🎧 マイク・スピーカーの確認</h2>
        <p class="mini muted">授業の前に、教室で使うマイクとスピーカーを選んで確かめましょう。選んだものはこのパソコンに記憶されます。</p>

        <section class="dev-block">
          <div class="dev-title">🎙 マイク</div>
          <select id="devMic" aria-label="マイク"></select>
          <div class="dev-meter" aria-hidden="true"><span id="devLevel"></span></div>
          <p class="mini muted" id="devMicHint">話してみてください。バーが緑に動けば、ALT にあなたの声が届きます。</p>
        </section>

        <section class="dev-block">
          <div class="dev-title">🔊 スピーカー</div>
          <select id="devSpk" aria-label="スピーカー" class="${canPickSpeaker ? '' : 'hide'}"></select>
          <p class="mini muted ${canPickSpeaker ? 'hide' : ''}">このブラウザ（Safari など）では、スピーカーをここで選べません。ALT の声は Mac の「サウンド」の出力から流れます。切り替えるときは、メニューバーの 🔊 か「システム設定 → サウンド → 出力」で選んでください。</p>
          <button type="button" class="btn btn-ghost btn-sm" id="devChime">▶ テスト音を鳴らす</button>
        </section>

        <section class="dev-block">
          <div class="dev-title">🔁 まとめて確認</div>
          <p class="mini muted">3秒間録音して、選んだスピーカーで再生します。教室の後ろでも聞こえるか確かめてください。</p>
          <button type="button" class="btn btn-ghost btn-sm" id="devRec">⏺ 3秒録音して再生</button>
        </section>

        <p class="mini ng hide" id="devErr"></p>
        <div class="actions">
          <button class="btn btn-primary">OK</button>
        </div>
      </form>`);

    const $d = (s) => dlg.querySelector(s);
    const err = (msg) => { const e = $d('#devErr'); e.textContent = msg; e.classList.toggle('hide', !msg); };

    function play(url) {
      const a = new Audio(url);
      const id = speakerId();
      players.add(a);
      a.onended = () => players.delete(a);
      const go = () => a.play().catch(() => err('音を再生できませんでした。'));
      if (canPickSpeaker && id) a.setSinkId(id).then(go, go); else go();
      return a;
    }

    function meter() {
      cancelAnimationFrame(raf);
      try { ctx?.close(); } catch {}
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      const bar = $d('#devLevel');
      let smooth = 0;
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const x of buf) sum += (x - 128) ** 2;
        const level = Math.min(1, (Math.sqrt(sum / buf.length) / 128) * 5);
        smooth = Math.max(level, smooth * 0.9);
        bar.style.width = `${Math.round(smooth * 100)}%`;
        bar.classList.toggle('loud', smooth > 0.15);
        raf = requestAnimationFrame(tick);
      };
      tick();
    }

    async function useMic(id) {
      stream?.getTracks().forEach((t) => t.stop());
      try {
        stream = await openMic(id);
        err('');
        meter();
        return stream.getAudioTracks()[0]?.getSettings?.().deviceId || id;
      } catch (e) {
        stream = null;
        err(e.name === 'NotAllowedError'
          ? 'マイクの使用が許可されていません。アドレスバーの左のボタン（またはブラウザの設定）で、このサイトのマイクを「許可」にしてください。'
          : `マイクを使えませんでした（${e.message || e.name}）。`);
        return id;
      }
    }

    async function fill() {
      const { mics, speakers } = await listDevices();
      const mic = micId();
      const using = stream?.getAudioTracks()[0]?.getSettings?.().deviceId;
      $d('#devMic').innerHTML = mics.map((d, i) =>
        `<option value="${esc(d.deviceId)}" ${d.deviceId === (mic || using) ? 'selected' : ''}>${esc(label(d, i, 'マイク'))}</option>`).join('')
        || '<option value="">マイクが見つかりません</option>';
      if (canPickSpeaker) {
        const spk = speakerId();
        $d('#devSpk').innerHTML = speakers.map((d, i) =>
          `<option value="${esc(d.deviceId === 'default' ? '' : d.deviceId)}" ${(d.deviceId === 'default' ? '' : d.deviceId) === spk ? 'selected' : ''}>${esc(label(d, i, 'スピーカー'))}</option>`).join('')
          || '<option value="">スピーカーが見つかりません</option>';
        if (spk && !speakers.some((d) => d.deviceId === spk)) {
          $d('#devSpk').insertAdjacentHTML('afterbegin', '<option value="" selected>（前に選んだスピーカーがありません。既定のスピーカーを使います）</option>');
        }
      }
      if (mic && !mics.some((d) => d.deviceId === mic)) {
        $d('#devMic').insertAdjacentHTML('afterbegin', '<option value="" selected>（前に選んだマイクがありません。既定のマイクを使います）</option>');
      }
    }

    $d('#devMic').onchange = async (e) => {
      write(KEY_MIC, e.target.value);
      await useMic(e.target.value);
      onChange?.('mic');
    };
    $d('#devSpk').onchange = (e) => {
      write(KEY_SPK, e.target.value);
      applySpeakerToAll();
      onChange?.('speaker');
      play(chime);
    };
    $d('#devChime').onclick = () => play(chime);
    $d('#devRec').onclick = () => {
      if (!stream || rec) return;
      const btn = $d('#devRec');
      const chunks = [];
      try { rec = new MediaRecorder(stream); } catch { err('このブラウザでは録音できません。'); return; }
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        rec = null;
        if (closed) return;
        btn.disabled = false;
        btn.textContent = '⏺ 3秒録音して再生';
        const url = URL.createObjectURL(new Blob(chunks, { type: chunks[0]?.type || 'audio/mp4' }));
        const a = play(url);
        btn.textContent = '🔊 再生中…';
        btn.disabled = true;
        const done = () => { btn.disabled = false; btn.textContent = '⏺ 3秒録音して再生'; URL.revokeObjectURL(url); };
        a.addEventListener('ended', done, { once: true });
        a.addEventListener('error', done, { once: true });
      };
      rec.start();
      btn.disabled = true;
      let left = 3;
      btn.textContent = `⏺ 録音中… ${left}`;
      const t = setInterval(() => {
        left -= 1;
        if (left > 0 && rec) btn.textContent = `⏺ 録音中… ${left}`;
        else { clearInterval(t); rec?.state === 'recording' && rec.stop(); }
      }, 1000);
    };

    const onDev = () => fill().catch(() => {});
    navigator.mediaDevices.addEventListener?.('devicechange', onDev);

    onDialogClose(dlg, () => {
      closed = true;
      cancelAnimationFrame(raf);
      try { rec?.state === 'recording' && rec.stop(); } catch {}
      stream?.getTracks().forEach((t) => t.stop());
      try { ctx?.close(); } catch {}
      for (const a of players) a.pause();
      URL.revokeObjectURL(chime);
      navigator.mediaDevices.removeEventListener?.('devicechange', onDev);
      resolve();
    });

    // Device names are shown only after the microphone is allowed, so open it first.
    useMic(micId()).then(fill).catch(() => fill());
  });
}
