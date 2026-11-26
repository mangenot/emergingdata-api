#!/usr/bin/env python3
"""Set up the site around the reports through the REST API: the site tagline and a few settings, the pages written in
wp/pages/<slug>.html (created, or updated in place when they exist), the home page as the front page, and the sample
content of a fresh WordPress moved to the trash. Safe to run again: everything is matched by slug.

    python3 setup_wp.py [--pages-only] [slug ...]
    WP_URL, WP_USER, WP_APP_PASSWORD   as for publish_wp.py (environment only; never printed)

A page file starts with a line "title: ..." then its content as HTML, one block per paragraph of the file (blank lines
between blocks): <h2>, <h3>, <p>, <ul> and shortcodes become the editor's own blocks, anything else (a <div> block)
a Custom HTML block, so that the texts can be edited on the site afterwards."""
import os, re, sys
from publish_wp import call, whoami, URL, USER, PASS

HERE = os.path.dirname(os.path.abspath(__file__))
PAGES = os.path.join(HERE, 'wp', 'pages')

SETTINGS = {
    'description': 'by EmergingTextiles.com',
    'timezone': 'Europe/Paris',
    'date_format': 'j F Y',
    'time_format': 'H:i',
    'start_of_week': 1,
    'default_comment_status': 'closed',
    'default_ping_status': 'closed',
    'use_smilies': False,
}


def blocks(html: str) -> str:
    """The content as editor blocks."""
    out = []
    for chunk in re.split(r'\n\s*\n', html.strip()):
        chunk = chunk.strip()
        if not chunk:
            continue
        if chunk.startswith('['):
            out.append(f'<!-- wp:shortcode -->\n{chunk}\n<!-- /wp:shortcode -->')
        elif re.match(r'<h([23])[\s>]', chunk):
            level = re.match(r'<h([23])', chunk).group(1)
            inner = re.sub(r'^<h[23][^>]*>|</h[23]>$', '', chunk)
            out.append(f'<!-- wp:heading {{"level":{level}}} -->\n<h{level} class="wp-block-heading">{inner}</h{level}>\n<!-- /wp:heading -->')
        elif re.match(r'<p[\s>]', chunk) and chunk.count('<p') == 1:
            cls = re.match(r'<p\s+class="([^"]+)"', chunk)
            inner = re.sub(r'^<p[^>]*>|</p>$', '', chunk)
            attrs = f' {{"className":"{cls.group(1)}"}}' if cls else ''
            out.append(f'<!-- wp:paragraph{attrs} -->\n<p{" class=" + chr(34) + cls.group(1) + chr(34) if cls else ""}>{inner}</p>\n<!-- /wp:paragraph -->')
        elif re.match(r'<ul[\s>]', chunk):
            items = re.findall(r'<li[^>]*>(.*?)</li>', chunk, re.S)
            lis = ''.join(f'<!-- wp:list-item -->\n<li>{i.strip()}</li>\n<!-- /wp:list-item -->\n' for i in items)
            out.append(f'<!-- wp:list -->\n<ul class="wp-block-list">{lis}</ul>\n<!-- /wp:list -->')
        else:
            out.append(f'<!-- wp:html -->\n{chunk}\n<!-- /wp:html -->')
    return '\n\n'.join(out)


def read_page(slug: str):
    text = open(os.path.join(PAGES, f'{slug}.html'), encoding='utf-8').read()
    first, _, rest = text.partition('\n')
    m = re.match(r'title:\s*(.+)', first.strip())
    if not m:
        raise SystemExit(f'{slug}.html: the first line must be "title: ..."')
    return m.group(1).strip(), blocks(rest)


def upsert_page(slug: str) -> int:
    title, content = read_page(slug)
    body = dict(title=title, slug=slug, content=content, status='publish', comment_status='closed', ping_status='closed')
    existing = call('GET', 'pages', slug=slug, status='publish,draft,pending,private', context='edit')
    if existing:
        r = call('POST', f"pages/{existing[0]['id']}", body)
        print(f"{slug}: updated page {r['id']} {r.get('link', '')}")
    else:
        r = call('POST', 'pages', body)
        print(f"{slug}: created page {r['id']} {r.get('link', '')}")
    return int(r['id'])


def trash_sample_content():
    for kind, slug in (('pages', 'sample-page'), ('pages', 'privacy-policy'), ('posts', 'hello-world')):     # privacy-policy: the stock draft; the site's page is wp/pages/privacy.html
        found = call('GET', kind, slug=slug, status='publish,draft', context='edit')
        for item in found:
            call('DELETE', f"{kind}/{item['id']}")
            print(f"{slug}: moved to the trash")


def settings(home_id: int | None):
    body = dict(SETTINGS)
    if home_id:
        body.update(show_on_front='page', page_on_front=home_id)
    r = call('POST', 'settings', body)
    print(f"settings: tagline \"{r.get('description')}\", timezone {r.get('timezone')}, front page {r.get('page_on_front')}")


if __name__ == '__main__':
    if not (URL and USER and PASS):
        raise SystemExit('WP_URL, WP_USER and WP_APP_PASSWORD must be set in the environment')
    whoami()
    slugs = [a for a in sys.argv[1:] if not a.startswith('--')] or sorted(f[:-5] for f in os.listdir(PAGES) if f.endswith('.html'))
    ids = {slug: upsert_page(slug) for slug in slugs}
    if '--pages-only' not in sys.argv:
        trash_sample_content()
        settings(ids.get('home'))
