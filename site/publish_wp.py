#!/usr/bin/env python3
"""Push the converted reports (wp/<iso>.txt and wp/<iso>.json, from to_wp.py) to the WordPress site through its REST
API, as drafts unless --publish is given. An existing report with the same slug is updated in place (its text and
fields), so the daily refresh can rewrite the drafts and an editor publishes them from the site.

    python3 publish_wp.py [--publish] [ISO ...]
    WP_URL            the site, e.g. https://emergingdata.net
    WP_USER           the WordPress user name
    WP_APP_PASSWORD   an application password of that user (Users > Profile > Application Passwords); never printed

The credentials come from the environment only (a GitHub secret in the Action, a shell variable by hand). They are sent
both as the standard Authorization header and as X-ED-Authorization, which the ED Reports plugin (1.0.1 or later) reads
on servers where Apache drops the standard header."""
import base64, json, os, sys, urllib.request, urllib.parse, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
WP = os.path.join(HERE, 'wp')
URL = os.environ.get('WP_URL', '').rstrip('/')
USER = os.environ.get('WP_USER', '')
PASS = os.environ.get('WP_APP_PASSWORD', '')


def call(method, path, body=None, **params):
    url = f"{URL}/wp-json/wp/v2/{path}" + (f"?{urllib.parse.urlencode(params)}" if params else '')
    data = json.dumps(body).encode('utf-8') if body is not None else None
    token = base64.b64encode(f"{USER}:{PASS}".encode('utf-8')).decode('ascii')
    req = urllib.request.Request(url, data=data, method=method, headers={'Authorization': f'Basic {token}', 'X-ED-Authorization': f'Basic {token}', 'Content-Type': 'application/json', 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path}: HTTP {e.code} {e.read().decode('utf-8', 'replace')[:300]}")


def whoami():
    """Check the login before anything else and explain a refusal: WordPress names the cause in its error code
    (rest_not_logged_in: the Authorization header never reached PHP; invalid_username / incorrect_password: the
    secrets; application_passwords_disabled: the feature is off on the site)."""
    url = f"{URL}/wp-json/wp/v2/users/me?context=edit"
    token = base64.b64encode(f"{USER}:{PASS}".encode('utf-8')).decode('ascii')
    req = urllib.request.Request(url, headers={'Authorization': f'Basic {token}', 'X-ED-Authorization': f'Basic {token}', 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            me = json.loads(r.read().decode('utf-8'))
            print(f"logged in as {me.get('slug')} (roles {', '.join(me.get('roles', []))})")
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'replace')
        try:
            code = json.loads(body).get('code')
        except Exception:
            code = body[:120]
        try:
            with urllib.request.urlopen(urllib.request.Request(f"{URL}/wp-json/", headers={'Accept': 'application/json'}), timeout=60) as r:
                idx = json.loads(r.read().decode('utf-8'))
            avail = 'application-passwords' in (idx.get('authentication') or {})
            plugin = any('ed-reports' in str(v) for v in idx.get('namespaces', [])) or 'ed' in str(idx.get('namespaces', ''))
            extra = f"; application passwords {'available' if avail else 'NOT available'} on the site"
        except Exception:
            extra = ''
        raise SystemExit(f"login refused: HTTP {e.code}, code {code}; user name length {len(USER)}, password length {len(PASS.replace(' ', ''))}{extra}. "
                         "WP_USER must be the login name of the user whose profile holds the application password; on a server that drops the Authorization header, the plugin must be 1.0.1 or later.")


def push(iso, publish):
    f = json.load(open(os.path.join(WP, f'{iso.lower()}.json'), encoding='utf-8'))
    content = open(os.path.join(WP, f'{iso.lower()}.txt'), encoding='utf-8').read()
    body = dict(title=f['title'], slug=f['slug'], content=content,
                meta={'_ed_iso': f['iso'], '_ed_subtitle': f['subtitle'], '_ed_meta': f['meta'], '_ed_edition': f['edition']})
    existing = call('GET', 'country-reports', slug=f['slug'], status='publish,draft,pending,private', context='edit')
    if existing:
        post = existing[0]
        if publish:
            body['status'] = 'publish'
        r = call('POST', f"country-reports/{post['id']}", body)
        print(f"{iso}: updated post {r['id']} ({r['status']}) {r.get('link', '')}")
    else:
        body['status'] = 'publish' if publish else 'draft'
        r = call('POST', 'country-reports', body)
        print(f"{iso}: created post {r['id']} ({r['status']}) {r.get('link', '')}")


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    publish = '--publish' in sys.argv
    if not (URL and USER and PASS):
        raise SystemExit('WP_URL, WP_USER and WP_APP_PASSWORD must be set in the environment')
    whoami()
    for iso in (args or ['BGD', 'HND', 'KEN', 'KHM', 'PAK']):
        push(iso.upper(), publish)
