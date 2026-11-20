#!/usr/bin/env python3
"""Stamp every script and the stylesheet in index.html with a version taken from its contents.

Browsers (Safari especially) keep using saved copies of the program files for a while, even
after a reload. With a version in each address (…/devices.js?v=1a2b3c4d), any file that changed
gets a new address and is always downloaded fresh. Run this before publishing:

    python3 tools/update-version.py
"""
import hashlib
import json
import pathlib
import re

root = pathlib.Path(__file__).resolve().parent.parent
index = root / 'index.html'


def ver(path):
    return hashlib.sha1(path.read_bytes()).hexdigest()[:8]


imports = {f'./js/{p.name}': f'./js/{p.name}?v={ver(p)}' for p in sorted((root / 'js').glob('*.js'))}
block = (
    '<!-- versions: written by tools/update-version.py -->\n'
    '  <script type="importmap">\n'
    + '\n'.join('  ' + line for line in json.dumps({'imports': imports}, indent=2).splitlines())
    + '\n  </script>\n  <!-- /versions -->'
)

html = index.read_text(encoding='utf-8')
if '<!-- versions:' in html:
    html = re.sub(r'<!-- versions:.*?<!-- /versions -->', lambda m: block, html, flags=re.S)
else:
    html = html.replace('<script type="module"', block + '\n  <script type="module"', 1)
html = re.sub(r'href="css/style\.css(\?v=\w+)?"', f'href="css/style.css?v={ver(root / "css/style.css")}"', html)
html = re.sub(r'src="js/app\.js(\?v=\w+)?"', f'src="js/app.js?v={ver(root / "js/app.js")}"', html)
index.write_text(html, encoding='utf-8')
print(f'index.html: {len(imports)} scripts and the stylesheet stamped')
