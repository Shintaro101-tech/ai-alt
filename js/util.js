// Small DOM helpers shared by every view.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);

export function toast(msg, kind = 'info') {
  const box = $('#toasts');
  const t = document.createElement('div');
  t.className = `toast toast-${kind}`;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 3700);
}

// Opens the shared <dialog>. `onSubmit(formData, form)` may return false to keep it open.
// All dialogs share one <dialog>. A "close" event from the previous dialog can arrive after the next one
// has opened, so a close only counts when the dialog is really closed.
export function onDialogClose(dlg, fn) {
  const handler = () => {
    if (dlg.open) return;
    dlg.removeEventListener('close', handler);
    fn();
  };
  dlg.addEventListener('close', handler);
}

export function openDialog(html, { onSubmit, onOpen } = {}) {
  const dlg = $('#dialog');
  dlg.innerHTML = html;
  const form = dlg.querySelector('form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const keep = (await onSubmit?.(new FormData(form), form)) === false;
      if (!keep) dlg.close();
    });
  }
  $$('[data-close]', dlg).forEach((b) => (b.onclick = () => dlg.close()));
  dlg.showModal();
  onOpen?.(dlg);
  return dlg;
}

export function confirmDialog(message, okLabel = 'OK') {
  return new Promise((resolve) => {
    let ok = false;
    const dlg = openDialog(`
      <form class="form">
        <p>${esc(message)}</p>
        <div class="actions">
          <button type="button" class="btn btn-ghost" data-close>キャンセル</button>
          <button class="btn btn-danger">${esc(okLabel)}</button>
        </div>
      </form>`, { onSubmit: () => { ok = true; } });
    onDialogClose(dlg, () => resolve(ok));
  });
}

// Slide text: one line per paragraph. "- " or "・" starts a bullet,
// **text** is highlighted (target language), and ____ stays as a gap.
export function richText(text) {
  const lines = String(text || '').split('\n');
  let html = '';
  let list = false;
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<mark>$1</mark>');
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*(?:[-・•])\s*(.*)$/);
    if (bullet) {
      if (!list) { html += '<ul>'; list = true; }
      html += `<li>${inline(bullet[1])}</li>`;
      continue;
    }
    if (list) { html += '</ul>'; list = false; }
    html += line.trim() ? `<p>${inline(line)}</p>` : '<div class="gap"></div>';
  }
  if (list) html += '</ul>';
  return html;
}

// Shrinks an uploaded picture so lessons stay small enough to store and export.
export function readImage(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('画像を読み込めませんでした。'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('この画像形式は使えません。'));
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        const g = c.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.88));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
