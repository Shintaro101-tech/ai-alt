// The four AI-ALTs (the same characters and artwork as 洋書トーク).
// Each avatar is a base image plus two overlays (eyes closed, mouth open). Overlay
// coordinates are in the original 1254×1254 artwork's pixels and are drawn with
// percentages, so the avatar scales to any box.

const ART = 1254;

export const ALTS = {
  emma: {
    name: 'Emma',
    fullName: 'Emma Bennett',
    from: 'アイルランド出身',
    flag: '🇮🇪',
    voice: 'willow',
    profile: '20代後半・ダブリン出身。温かく率直で、生徒の話をよく聞いてくれる。',
    persona: `Emma Bennett, an ALT in her late twenties from Dublin, Ireland.
Personality: warm, frank and observant. You listen carefully and react with genuine interest. You like cooking, cafés and walks by the sea.`,
    accent: 'Speak with a natural, friendly Irish English accent (Dublin), clear and easy for learners to follow.',
    art: {
      dir: 'assets/avatars/emma',
      view: { x: 315, y: 70, size: 600 },
      face: { x: 430, y: 130, size: 370 },
      eyes: { x: 492, y: 212, w: 246, h: 96 },
      mouth: { x: 559, y: 325, w: 127, h: 94 },
    },
  },
  oliver: {
    name: 'Oliver',
    fullName: 'Oliver Reed',
    from: 'イギリス出身',
    flag: '🇬🇧',
    voice: 'vesper',
    profile: '30代前半・イギリス出身。穏やかで好奇心が強く、生徒が考えている間も急かさず待ってくれる。',
    persona: `Oliver Reed, an ALT in his early thirties from England.
Personality: calm and curious, with an occasional dry, understated joke. You never rush students — if they are thinking, you wait and reassure them ("Take your time."). You like reading, football and tea.`,
    accent: 'Speak with a natural, calm British (southern English) accent, clear and easy for learners to follow.',
    art: {
      dir: 'assets/avatars/oliver',
      view: { x: 312, y: 50, size: 600 },
      face: { x: 427, y: 120, size: 370 },
      eyes: { x: 501, y: 204, w: 220, h: 84 },
      mouth: { x: 546, y: 319, w: 140, h: 74 },
    },
  },
  noah: {
    name: 'Noah',
    fullName: 'Noah Brooks',
    from: 'オーストラリア出身',
    flag: '🇦🇺',
    voice: 'ripple',
    profile: '30代前半・メルボルン出身。気さくでユーモアがあり、身近な例で説明してくれる。',
    persona: `Noah Brooks, an ALT in his early thirties from Melbourne, Australia.
Personality: relaxed, approachable and funny. You connect English to students' everyday lives and explain with familiar examples. You like surfing, camping and cooking barbecues.`,
    accent: 'Speak with a natural, relaxed Australian English accent (Melbourne), clear and easy for learners to follow. Use an everyday Aussie expression now and then and explain it if students seem unsure.',
    art: {
      dir: 'assets/avatars/noah',
      view: { x: 312, y: 40, size: 600 },
      face: { x: 430, y: 110, size: 370 },
      eyes: { x: 512, y: 199, w: 216, h: 81 },
      mouth: { x: 548, y: 307, w: 151, h: 102 },
    },
  },
  chloe: {
    name: 'Chloe',
    fullName: 'Chloe Parker',
    from: 'アメリカ出身',
    flag: '🇺🇸',
    voice: 'gleam',
    profile: '20代後半・アメリカ出身。明るく想像力豊かで、間違いを気にせず話せる雰囲気をつくる。',
    persona: `Chloe Parker, an ALT in her late twenties from the United States.
Personality: cheerful, imaginative and a little playful. You create a relaxed mood so students don't worry about making mistakes. You like movies, drawing and trying new food.`,
    accent: 'Speak with a natural, friendly General American accent, clear and easy for learners to follow.',
    art: {
      dir: 'assets/avatars/chloe',
      view: { x: 325, y: 50, size: 600 },
      face: { x: 442, y: 120, size: 370 },
      eyes: { x: 492, y: 207, w: 260, h: 105 },
      mouth: { x: 563, y: 324, w: 133, h: 101 },
    },
  },
};

export const altKey = (key) => (ALTS[key] ? key : 'emma');

const pct = (n) => `${+(n * 100).toFixed(3)}%`;

// framing: 'view' (bust, for the stage) | 'face' (thumbnails)
export function avatarHTML(key, { framing = 'view' } = {}) {
  key = altKey(key);
  const a = ALTS[key];
  const v = a.art[framing];
  const place = (b) => `left:${pct(b.x / ART)};top:${pct(b.y / ART)};width:${pct(b.w / ART)};height:${pct(b.h / ART)}`;
  const blink = `animation-duration:${(3.6 + Math.random() * 2.6).toFixed(2)}s;animation-delay:${(-Math.random() * 4).toFixed(2)}s`;
  return `
    <div class="av" role="img" aria-label="${a.name}" style="background-image:url('${a.art.dir}/background.jpg')">
      <div class="av-rig" style="left:${pct(-v.x / v.size)};top:${pct(-v.y / v.size)};width:${pct(ART / v.size)}">
        <img class="av-base" src="${a.art.dir}/base.webp" alt="" draggable="false">
        <img class="av-eyes" src="${a.art.dir}/eyes-closed.png" alt="" draggable="false" style="${place(a.art.eyes)};${blink}">
        <img class="av-mouth" src="${a.art.dir}/mouth-open.png" alt="" draggable="false" style="${place(a.art.mouth)}">
      </div>
    </div>`;
}

// Opens/closes the mouth from an audio level (0–1), with hysteresis so it flaps
// with the syllables instead of flickering.
export function lipSync(target) {
  let open = false;
  let since = 0;
  return (level) => {
    const now = performance.now();
    const want = open ? level > 0.07 : level > 0.13;
    if (want !== open && now - since > 70) {
      open = want;
      since = now;
      (typeof target === 'function' ? target() : target)?.classList.toggle('mouth-open', open);
    }
    return open;
  };
}

// Drives the avatar's mouth from the ALT's audio level.
export function createMeter() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  let raf = 0;
  let src = null;
  return {
    attach(stream, box) {
      src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      let smooth = 0;
      const sync = lipSync(() => box.querySelector('.av'));
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += (v - 128) ** 2;
        const rms = Math.sqrt(sum / buf.length) / 128;
        smooth = smooth * 0.6 + Math.min(1, rms * 6) * 0.4;
        sync(Math.min(1, rms * 6));
        box.classList.toggle('speaking', smooth > 0.08);
        raf = requestAnimationFrame(tick);
      };
      tick();
    },
    stop() {
      cancelAnimationFrame(raf);
      document.querySelectorAll('.av.mouth-open').forEach((av) => av.classList.remove('mouth-open'));
      document.querySelectorAll('.speaking').forEach((b) => b.classList.remove('speaking'));
      try { src?.disconnect(); } catch {}
      ctx.close();
    },
  };
}
