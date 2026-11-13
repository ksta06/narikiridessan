"""ローカルで画面を確認するためのサーバー（GAS には貼り付けない）

    python dev/preview.py

ブラウザで http://localhost:8765 を開く。
dev/build.py と同じ方法で html・css・js を 1 つにまとめ、GAS の代わりに dev/mock.js を差し込んで表示する。
ファイルを保存して再読み込みすれば反映される（dist/ を作り直す必要はない）。
"""
import http.server

from build import render, ROOT

PORT = 8765


def render_preview():
    mock = (ROOT / 'dev' / 'mock.js').read_text(encoding='utf-8')
    viewport = '<meta name="viewport" content="width=device-width, initial-scale=1">'
    return render().replace('<head>', f'<head>\n{viewport}\n<script>\n{mock}</script>', 1)


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.split('?')[0] not in ('/', '/index.html'):
            self.send_error(404)
            return
        try:
            body = render_preview().encode('utf-8')
            status = 200
        except FileNotFoundError as e:
            body = f'ファイルが見つかりません: {e.filename}'.encode('utf-8')
            status = 500
        self.send_response(status)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    print(f'http://localhost:{PORT}')
    http.server.ThreadingHTTPServer(('localhost', PORT), Handler).serve_forever()
