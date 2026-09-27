"""Download organelle, mutation and plasmid icons from pathogenic.wiki.

    pip install pillow
    python3 tools/extract/wiki_icons.py [--force]

Icons are game art: the wiki serves them as /images/<kind>/<id>.png, where <id>
is the same slug the calculator uses. Each one is shrunk to at most 128 pixels
on its longest side and saved as public/art/<kind>/<id>.webp.
"""
import io
import os
import re
import sys
import time
import urllib.error
import urllib.request

from PIL import Image

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BASE = 'https://pathogenic.wiki/images'
UA = {'User-Agent': 'Mozilla/5.0 (pathogenic-dps icons; github.com/cskb75/pathogenic-dps)'}
SOURCES = {
    'organelles': ('src/data/organelles.ts', r'\bid: "([a-z0-9-]+)"'),
    'mutations': ('src/data/mutations.ts', r'\bid: "([a-z0-9-]+)"'),
    'plasmids': ('src/data/plasmids.ts', r'"id": "([a-z0-9-]+)"'),
}
MAX = 128


def fetch(url):
    for attempt in range(4):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40).read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(2 ** attempt)
        except OSError:
            time.sleep(2 ** attempt)
    return None


def main(force):
    missing = []
    for kind, (path, pattern) in SOURCES.items():
        ids = sorted(set(re.findall(pattern, open(os.path.join(REPO, path)).read())))
        out_dir = os.path.join(REPO, 'public', 'art', kind)
        os.makedirs(out_dir, exist_ok=True)
        done = 0
        for i in ids:
            out = os.path.join(out_dir, f'{i}.webp')
            if os.path.exists(out) and not force:
                continue
            data = fetch(f'{BASE}/{kind}/{i}.png')
            if not data:
                missing.append(f'{kind}/{i}')
                continue
            im = Image.open(io.BytesIO(data)).convert('RGBA')
            im = im.crop(im.getchannel('A').getbbox() or (0, 0, im.width, im.height))
            im.thumbnail((MAX, MAX), Image.LANCZOS)
            im.save(out, 'WEBP', quality=82, method=6)
            done += 1
        print(f'{kind}: {len(ids)} ids, {done} downloaded')
    if missing:
        print('no icon for:', ', '.join(missing))


if __name__ == '__main__':
    main('--force' in sys.argv)
