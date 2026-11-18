// CEFR levels the teacher can pick. `guide` goes into the ALT's instructions
// and controls speaking speed, vocabulary, grammar and turn length.
export const LEVELS = {
  'Pre-A1': {
    ja: 'ごく簡単な単語・あいさつ',
    guide: `Pre-A1 (absolute beginners). Speak VERY slowly and clearly, with a short pause between phrases. Use only the most basic, everyday words (about the first 300-500 words: family, food, colors, numbers, school, home). Use very short sentences of 3-6 words, mostly present simple and "I like / I have / There is". Keep each turn to one or two short sentences. Repeat key words, and use gestures-style words like "Look!" or "This one". Ask yes/no or either/or questions ("Is it big or small?"). If they don't understand, say the same thing again more slowly with simpler words.`,
  },
  A1: {
    ja: '基本的な日常表現',
    guide: `A1 (beginners). Speak slowly and clearly, with small pauses between phrases. Use high-frequency everyday words (about the first 1,000 words). Use short, simple sentences (5-8 words) and basic grammar: present simple, can, there is/are, simple past of common verbs. Keep each turn to one or two sentences. Avoid idioms, phrasal verbs and slang. Ask simple questions with clear choices. Repeat or rephrase when needed.`,
  },
  A2: {
    ja: '身近な話題を簡単に',
    guide: `A2 (elementary). Speak a little slower than natural speed, clearly. Use common everyday vocabulary (about the first 2,000 words) about familiar topics: home, school, hobbies, town, travel. Use short sentences joined with and, but, because, so. Avoid idioms and rare words; if you use a new word, explain it simply. Keep each turn to 1-3 sentences. Ask simple open questions ("What do you like about...?") and give an example answer if they hesitate.`,
  },
  'A2+': {
    ja: 'A2の上位・B1の手前',
    guide: `A2+ (strong elementary). Speak slightly slower than natural speed. Use everyday vocabulary (about the first 2,500 words) plus a few useful topic words, explained if needed. Use mostly simple sentences with some longer ones (if, when, because, so). Use only very common phrasal verbs (go out, look for). Keep each turn to 2-3 sentences. Ask open questions and simple follow-up questions ("Why?", "What happened next?").`,
  },
  B1: {
    ja: '自分の考えや理由を話せる',
    guide: `B1 (intermediate). Speak at a natural but unhurried speed. Use a wide range of everyday vocabulary (about 3,000 words) and common phrasal verbs and expressions, explaining less common ones. Use a mix of simple and complex sentences. Keep each turn to 2-4 sentences. Ask questions that invite opinions and reasons ("What do you think?", "Why do you feel that way?").`,
  },
  B2: {
    ja: '幅広い話題で議論できる',
    guide: `B2 (upper intermediate). Speak at a natural speed. Use natural, varied vocabulary including common idioms and phrasal verbs, and some topic-specific words. Use complex sentences freely. Turns can be 3-5 sentences when useful. Ask questions that make students compare, justify and give examples, and react naturally to what they say.`,
  },
  C1: {
    ja: '複雑な内容も自然に',
    guide: `C1 (advanced). Speak at a natural, native-like speed. Use rich, precise and idiomatic vocabulary, and nuanced or abstract language where it fits. Use the full range of grammar. Talk as you would with a fluent adult: share opinions, challenge ideas politely, and ask thought-provoking questions.`,
  },
};

export const LEVEL_KEYS = Object.keys(LEVELS);
export const DEFAULT_LEVEL = 'A2';
export const levelKey = (k) => (LEVELS[k] ? k : DEFAULT_LEVEL);

// Speaking speed. GPT-Live has no speed setting, so the ALT is told a target pace
// in words per minute (WPM) for each level, made slower or faster by the teacher's choice.
const BASE_WPM = { 'Pre-A1': 80, A1: 90, A2: 100, 'A2+': 105, B1: 120, B2: 140, C1: 160 };
export const PACES = {
  slower: { ja: '🐢 とてもゆっくり', factor: 0.75 },
  slow: { ja: 'ゆっくり', factor: 0.88 },
  normal: { ja: 'レベルどおり', factor: 1 },
};
export const PACE_KEYS = Object.keys(PACES);
export const paceKey = (k) => (PACES[k] ? k : 'normal');

export function paceText(cefr, pace) {
  const wpm = Math.round((BASE_WPM[levelKey(cefr)] * PACES[paceKey(pace)].factor) / 5) * 5;
  const slow = wpm <= 110;
  return `SPEAKING SPEED (very important): speak at about ${wpm} words per minute${slow ? ', which is much slower than your natural speed' : ''}. ${slow ? 'Say every word clearly and fully, without linking words together. Put a short pause (about half a second) after every phrase and a longer pause after every sentence. ' : ''}Keep this speed for the whole lesson, including scripted answers and long answers, and don't speed up as the conversation goes on.`;
}
