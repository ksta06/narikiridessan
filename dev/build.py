"""GAS に貼り付けるファイルを dist/ に作る

    python dev/build.py

html/index.html の <!-- @include パス --> を、そのファイルの中身に置き換えて 1 つの HTML にまとめる。
  .css  → <style> で囲んで埋め込む
  .js   → <script> で囲んで埋め込む
  .html → そのまま埋め込む（中の @include もさらに展開する）

出力（この 3 つを GAS に入れる）
  dist/index.html
  dist/Code.gs
  dist/appsscript.json
"""
import pathlib
import re
import shutil

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'
# 1 行の <!-- @include パス  説明（任意） --> にだけ一致させる
INCLUDE = re.compile(r'^([ \t]*)<!--[ \t]*@include[ \t]+(\S+)[^\n]*?-->[ \t]*$', re.M)


def expand(path):
    """path（プロジェクトからの相対パス）を読み込み、@include を展開した文字列を返す"""
    text = (ROOT / path).read_text(encoding='utf-8')
    suffix = pathlib.Path(path).suffix
    if suffix == '.css':
        return '<style>\n' + text.rstrip('\n') + '\n</style>'
    if suffix == '.js':
        return '<script>\n' + text.rstrip('\n') + '\n</script>'

    def replace(match):
        indent, target = match.group(1), match.group(2)
        body = expand(target)
        return '\n'.join(indent + line if line else line for line in body.split('\n'))

    return INCLUDE.sub(replace, text.rstrip('\n'))


def render():
    return expand('html/index.html') + '\n'


def build():
    DIST.mkdir(exist_ok=True)
    (DIST / 'index.html').write_text(render(), encoding='utf-8')
    shutil.copy(ROOT / 'Code.gs', DIST / 'Code.gs')
    shutil.copy(ROOT / 'appsscript.json', DIST / 'appsscript.json')
    for name in ('index.html', 'Code.gs', 'appsscript.json'):
        print('dist/' + name)


if __name__ == '__main__':
    build()
