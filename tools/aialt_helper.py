#!/usr/bin/env python3
"""AI-ALT の変換係（このMacの裏で動く小さなサーバー）。

AI-ALT の編集画面で .pptx を選ぶと、ブラウザがこのサーバーにファイルを送り、
pptx2aialt.py（PowerPoint で各クリックの状態を描く）で変換した結果を返します。

- このMacの中（127.0.0.1:8766）からしか接続できません
- 受け付けるのは AI-ALT のページ（公開サイトと localhost:8765）からだけです
- インストール：tools/変換係をインストール.command（ログイン時に自動で起動）
"""
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

HOST, PORT = '127.0.0.1', 8766
VERSION = 3
MAX_BYTES = 400 * 1024 * 1024
ALLOWED_ORIGINS = {
    'https://shintaro101-tech.github.io',
    'http://localhost:8765',
    'http://127.0.0.1:8765',
}
# The helper's own bridge page (used by Safari, which blocks https pages from calling http://127.0.0.1).
SELF_ORIGIN = f'http://127.0.0.1:{PORT}'

BRIDGE_HTML = '''<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>AI-ALT 変換係</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body { margin: 0; font-family: 'Hiragino Sans', system-ui, sans-serif; background: #F3F6FB; color: #13233A; display: grid; place-items: center; min-height: 100vh; }
main { text-align: center; padding: 24px; }
h1 { font-size: 1.1rem; color: #123A6B; margin: 0 0 10px; }
p { margin: 6px 0; font-size: .9rem; }
.bar { width: 260px; height: 8px; border-radius: 99px; background: #DDE6F2; overflow: hidden; margin: 14px auto; }
.bar span { display: block; height: 100%; width: 35%; background: #1E5AA0; border-radius: 99px; animation: m 1.4s ease-in-out infinite; }
@keyframes m { from { transform: translateX(-100%); } to { transform: translateX(290%); } }
.err { color: #B42318; font-weight: 700; }
</style></head>
<body><main>
<h1>📥 AI-ALT 変換係</h1>
<p id="msg">AI-ALT からファイルを受け取っています…</p>
<div class="bar" id="bar"><span></span></div>
<p id="sub" style="color:#63718A;font-size:.8rem">変換が終わると、このウィンドウは自動で閉じます。</p>
</main>
<script>
const ALLOWED = __ALLOWED__;
const msg = document.getElementById('msg');
let busy = false;
let heard = false;
window.addEventListener('message', async (e) => {
  if (!ALLOWED.includes(e.origin) || !e.data) return;
  // Safari cuts window.opener for this window, so the AI-ALT page calls first and we answer.
  if (e.data.type === 'aialt-hello') { heard = true; e.source.postMessage({ type: 'aialt-ready' }, e.origin); return; }
  if (e.data.type !== 'aialt-convert' || busy) return;
  busy = true;
  const reply = (data) => e.source.postMessage({ type: 'aialt-result', ...data }, e.origin);
  msg.textContent = `変換しています：${e.data.name}`;
  const t0 = Date.now();
  const tick = setInterval(() => { document.getElementById('sub').textContent = `${Math.round((Date.now() - t0) / 1000)} 秒（PowerPoint が開いて閉じます）`; }, 1000);
  try {
    const res = await fetch('/convert', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(e.data.name) }, body: e.data.buf });
    const j = await res.json().catch(() => ({ ok: false, error: `変換できませんでした (${res.status})` }));
    reply(j);
    clearInterval(tick);
    if (j.ok) { msg.textContent = '完了しました。'; setTimeout(() => window.close(), 300); }
    else { msg.textContent = j.error || '変換できませんでした。'; msg.className = 'err'; document.getElementById('bar').remove(); }
  } catch (err) {
    clearInterval(tick);
    reply({ ok: false, error: '変換係に接続できませんでした。' });
    msg.textContent = '変換係に接続できませんでした。'; msg.className = 'err';
  }
});
// Tell the AI-ALT page that this window is ready (where the browser keeps window.opener).
if (window.opener) for (const o of ALLOWED) { try { window.opener.postMessage({ type: 'aialt-ready' }, o); } catch (_) {} }
setTimeout(() => {
  if (heard || busy) return;
  msg.textContent = 'AI-ALT からの連絡がありません。このウィンドウを閉じて、AI-ALT でもう一度試してください。';
  document.getElementById('bar').remove();
}, 15000);
</script>
</body></html>
'''.replace('__ALLOWED__', json.dumps(sorted(ALLOWED_ORIGINS)))
# PowerPoint is sandboxed: it reads and writes in a fixed folder that it is allowed to use.
WORK = os.path.join(HERE, '_work')

lock = threading.Lock()


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, file=sys.stderr, flush=True)


class Handler(BaseHTTPRequestHandler):
    server_version = 'AIALTHelper/1'

    def log_message(self, fmt, *args):
        log(self.address_string(), fmt % args)

    def origin_ok(self):
        return self.headers.get('Origin') in ALLOWED_ORIGINS or self.headers.get('Origin') == SELF_ORIGIN

    def cors(self):
        origin = self.headers.get('Origin')
        if origin in ALLOWED_ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Filename')
            self.send_header('Access-Control-Allow-Private-Network', 'true')
            self.send_header('Access-Control-Max-Age', '600')

    def reply(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.cors()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204 if self.origin_ok() else 403)
        self.cors()
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        if self.path.split('?')[0] == '/bridge':
            body = BRIDGE_HTML.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.split('?')[0] == '/ping':
            return self.reply(200, {'ok': True, 'app': 'AI-ALT helper', 'version': VERSION, 'busy': lock.locked()})
        self.reply(404, {'ok': False, 'error': 'not found'})

    def do_POST(self):
        if self.path.split('?')[0] != '/convert':
            return self.reply(404, {'ok': False, 'error': 'not found'})
        if not self.origin_ok():
            return self.reply(403, {'ok': False, 'error': 'このページからは使えません。'})
        size = int(self.headers.get('Content-Length') or 0)
        if size <= 0 or size > MAX_BYTES:
            return self.reply(413, {'ok': False, 'error': 'ファイルが大きすぎるか、空です。'})
        name = os.path.basename(unquote(self.headers.get('X-Filename') or 'slides.pptx')) or 'slides.pptx'
        if not name.lower().endswith('.pptx'):
            return self.reply(400, {'ok': False, 'error': '.pptx ファイルを選んでください。（.ppt は PowerPoint で .pptx に保存し直してください）'})
        data = self.rfile.read(size)
        if not lock.acquire(blocking=False):
            return self.reply(409, {'ok': False, 'error': '別のファイルを変換中です。終わってからもう一度試してください。'})
        try:
            self.reply(200, convert_bytes(name, data))
        except BaseException as err:  # the converter reports problems with SystemExit
            log('error:', repr(err))
            traceback.print_exc()
            msg = str(err) if isinstance(err, SystemExit) and not isinstance(err.code, int) else f'変換できませんでした: {err}'
            self.reply(500, {'ok': False, 'error': msg})
        finally:
            lock.release()


def convert_bytes(name, data):
    # Loaded fresh every time, so an updated converter is used without restarting the helper.
    import importlib
    import pptx2aialt
    convert = importlib.reload(pptx2aialt).convert

    # Always the same folder (no new sub-folders), so PowerPoint asks for file access only once.
    os.makedirs(WORK, exist_ok=True)
    stem = f'job_{os.getpid()}_{int(time.time() * 1000)}'
    src = os.path.join(WORK, f'{stem}.pptx')
    out_dir = tempfile.mkdtemp(prefix='aialt_out_')
    try:
        with open(src, 'wb') as f:
            f.write(data)
        out = os.path.join(out_dir, 'out.aialt-slides.json')
        started = time.time()
        log(f'変換開始: {name}（{len(data) // 1024} KB）')
        result = convert(src, out)
        result['name'] = os.path.splitext(name)[0]
        log(f'変換終了: {name}（{time.time() - started:.1f} 秒）')
        return {'ok': True, 'deck': result}
    finally:
        if os.path.exists(src):
            os.remove(src)
        shutil.rmtree(out_dir, ignore_errors=True)


def main():
    os.makedirs(WORK, exist_ok=True)
    os.environ['PATH'] = '/opt/homebrew/bin:/usr/local/bin:' + os.environ.get('PATH', '/usr/bin:/bin')
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    log(f'AI-ALT の変換係を起動しました: http://{HOST}:{PORT}')
    server.serve_forever()


if __name__ == '__main__':
    main()
