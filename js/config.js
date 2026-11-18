// The relay server (Cloudflare Worker) shared with 洋書トーク. It holds the OpenAI API key.
// The relay only answers pages it knows: https://shintaro101-tech.github.io (GitHub Pages)
// and http://localhost:8765 (local). Serve AI-ALT from one of those (see README.md).
// To try a local `wrangler dev` relay, run in the console:
//   localStorage.setItem('aialt:worker', 'http://localhost:8787')
const DEPLOYED_WORKER_URL = 'https://yosho-talk-api.gotta-do-more-gotta-be-more.workers.dev';

export const WORKER_URL = (() => {
  try { return localStorage.getItem('aialt:worker') || DEPLOYED_WORKER_URL; } catch { return DEPLOYED_WORKER_URL; }
})();
