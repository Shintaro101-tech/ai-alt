// AI-ALT — router.
//   #/            lessons
//   #/edit/<id>   lesson editor
//   #/class/<id>  classroom (the ALT and the display)

import { renderHome } from './home.js';
import { renderEditor } from './editor.js';
import { renderClass } from './classroom.js';
import { seedSample } from './store.js';
import { $, toast } from './util.js';

let cleanup = null;

async function route() {
  try { cleanup?.(); } catch {}
  cleanup = null;
  const app = $('#app');
  const [, view, id] = (location.hash || '#/').split('/');
  app.innerHTML = '';
  app.className = '';
  try {
    if (view === 'edit' && id) cleanup = await renderEditor(app, decodeURIComponent(id));
    else if (view === 'class' && id) cleanup = await renderClass(app, decodeURIComponent(id));
    else cleanup = await renderHome(app);
  } catch (err) {
    console.error(err);
    toast(err.message || String(err), 'error');
  }
}

window.addEventListener('hashchange', route);
seedSample().catch(console.error).finally(route);
