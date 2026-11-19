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
VERSION = 1
MAX_BYTES = 400 * 1024 * 1024
ALLOWED_ORIGINS = {
    'https://shintaro101-tech.github.io',
    'http://localhost:8765',
    'http://127.0.0.1:8765',
}
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
        return self.headers.get('Origin') in ALLOWED_ORIGINS

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
    from pptx2aialt import convert  # imported here so that /ping works even if python-pptx is missing

    os.makedirs(WORK, exist_ok=True)
    job = tempfile.mkdtemp(prefix='job_', dir=WORK)
    try:
        src = os.path.join(job, name)
        with open(src, 'wb') as f:
            f.write(data)
        out = os.path.join(job, 'out.aialt-slides.json')
        started = time.time()
        log(f'変換開始: {name}（{len(data) // 1024} KB）')
        result = convert(src, out)
        log(f'変換終了: {name}（{time.time() - started:.1f} 秒）')
        return {'ok': True, 'deck': result}
    finally:
        shutil.rmtree(job, ignore_errors=True)


def main():
    os.makedirs(WORK, exist_ok=True)
    os.environ['PATH'] = '/opt/homebrew/bin:/usr/local/bin:' + os.environ.get('PATH', '/usr/bin:/bin')
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    log(f'AI-ALT の変換係を起動しました: http://{HOST}:{PORT}')
    server.serve_forever()


if __name__ == '__main__':
    main()
