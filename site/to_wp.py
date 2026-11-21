#!/usr/bin/env python3
"""Convert the country specs (specs/<iso>.py) into WordPress post content for the ED Reports plugin: the text with
its shortcodes in wp/<iso>.txt and the report fields (title, subtitle, series line, edition, country code) in
wp/<iso>.json. The computed parts (tiles' trends, currency block, trade tiles, charts, benchmark, scores) are not
converted: the plugin fills them from the API at display time.

    python3 to_wp.py [ISO ...]        all five countries when none is given
"""
import json, os, sys, re
from build_pages import load_spec, sections_of, EDITION

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'wp')


def attr(name, value):
    """A shortcode attribute: brackets escaped, quotes chosen to fit the value."""
    if value is None or value == '':
        return ''
    v = str(value).replace('[', '&#91;').replace(']', '&#93;').replace('\n', ' ')
    if '"' in v and "'" in v:
        v = v.replace('"', '&quot;')
    q = "'" if '"' in v else '"'
    return f' {name}={q}{v}{q}'


def lines_of(text):
    """The sentences of a text part, one per line; paragraphs separated by a blank line."""
    if isinstance(text, (list, tuple)):
        return '\n'.join(text)
    paras = text.split('</p><p class="text">')
    return '\n\n'.join(p.replace('<br>', '\n').replace('<br/>', '\n').strip() for p in paras)


def fig_sc(f):
    if isinstance(f, (list, tuple)):
        label, value, unit, note = (list(f) + ['', ''])[:4]
        f = dict(label=label, value=value, unit=unit, note=note)
    atts = attr('label', f.get('label')) + attr('value', f.get('value')) + attr('unit', f.get('unit')) + attr('code', f.get('code'))
    tr = f.get('trend')
    if tr:
        parts = [tr.get('dir', 'flat'), tr.get('change', ''), tr.get('short', 'flat'), tr.get('long', 'flat')]
        if tr.get('when'):
            parts.append(tr['when'])
        atts += attr('trend', '|'.join(parts))
    return f"  [ed_fig{atts}]{f.get('note', '')}[/ed_fig]"


def chart_sc(code, spec):
    series = ';'.join(f"{s['code']}:{s['name']}" + (f":{s['scale']}" if s.get('scale') else '') for s in spec['series'])
    atts = attr('code', code) + attr('title', spec.get('title')) + attr('unit', spec.get('unit')) + attr('decimals', spec.get('decimals', 0))
    if spec.get('tickDecimals') is not None:
        atts += attr('tick', spec['tickDecimals'])
    if spec.get('zero'):
        atts += attr('zero', 1)
    if spec.get('step'):
        atts += attr('step', 1)
    atts += attr('series', series)
    return f"  [ed_chart{atts}]"


def convert(iso):
    spec = load_spec(iso)
    out = []
    ov = spec.get('overview')
    if ov:
        body = []
        for heading, paras in ov.get('paras', []):
            if heading:
                body.append(f'<h3>{heading}</h3>')
            body += [f'<p>{p}</p>' for p in paras]
        out.append(f"[ed_overview{attr('date', ov['date'])}]\n[ed_standfirst]{ov['standfirst']}[/ed_standfirst]\n" + '\n'.join(body)
                   + f"\n[ed_byline]{ov['byline']}[/ed_byline]\n[/ed_overview]")
    out.append('[ed_global]')
    cur = spec.get('currency') or {}
    for key, sec in sections_of(spec):
        s = [f"[ed_section{attr('key', key)}]", f"[ed_lead]{sec['lead']}[/ed_lead]"]
        if key == 'FIN' and cur:
            rate = cur.get('rate') or {}
            s.append(f"[ed_currency{attr('then', cur.get('then', 'Public finances and the banks'))}{attr('rate', rate.get('value'))}{attr('rate_note', rate.get('note'))}]\n"
                     + lines_of(cur.get('text') or []) + "\n[/ed_currency]")
            if 'FX_USD' in spec['charts']:      # the report's own wording of the exchange rate chart, in place of the plugin's default
                s.append(chart_sc('FX_USD', spec['charts']['FX_USD']).strip())
        s.append(f"[ed_text]\n{lines_of(sec['text'])}\n[/ed_text]")
        ups = sec.get('updates') or []
        if ups:
            s.append('[ed_updates]\n' + '\n'.join(f"  [ed_update{attr('dir', d)}]{t}[/ed_update]" for d, t in ups) + '\n[/ed_updates]')
        figs = [f for f in sec.get('figs', []) if (f['label'] if isinstance(f, dict) else f[0]) != 'Exchange rate']
        if figs:
            s.append('[ed_figs]\n' + '\n'.join(fig_sc(f) for f in figs) + '\n[/ed_figs]')
        charts = sec.get('charts') or []
        if charts:
            s.append('[ed_charts]\n' + '\n'.join(chart_sc(c, spec['charts'][c]) for c in charts if c in spec['charts']) + '\n[/ed_charts]')
        risks = sec.get('risks') or []
        if risks:
            items = []
            for r in risks:
                watch = f"[ed_watch]{r['watch']}[/ed_watch]" if r.get('watch') else ''
                items.append(f"  [ed_risk{attr('level', r['level'])}{attr('title', r['title'])}{attr('horizon', r['horizon'])}]{r['text']}{watch}[/ed_risk]")
            s.append('[ed_risks]\n' + '\n'.join(items) + '\n[/ed_risks]')
        if sec.get('gap'):
            s.append(f"[ed_gap]{sec['gap']}[/ed_gap]")
        s.append('[/ed_section]')
        out.append('\n'.join(s))
    facts = spec.get('facts') or []
    if facts:
        out.append('[ed_facts]\n' + '\n'.join(f"  [ed_fact{attr('label', dt)}]{dd}[/ed_fact]" for dt, dd in facts) + '\n[/ed_facts]')
    out.append('[ed_benchmark]')
    out.append('[ed_scores]')
    out.append('[ed_method]\n[ed_sources]\n' + '\n'.join(spec.get('sources') or []) + '\n[/ed_sources]\n[/ed_method]')
    content = '\n\n'.join(out) + '\n'
    fields = dict(iso=iso, title=spec['name'], subtitle=spec['sub'], meta=spec['meta'], edition=EDITION, slug=f"{spec['name'].lower().replace(' ', '-')}-apparel")
    os.makedirs(OUT, exist_ok=True)
    open(os.path.join(OUT, f'{iso.lower()}.txt'), 'w', encoding='utf-8').write(content)
    json.dump(fields, open(os.path.join(OUT, f'{iso.lower()}.json'), 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    bad = re.findall(r'\bpilot\b', content, re.I)
    print(f"{iso}: {len(content):,} bytes, {content.count('[ed_section')} sections, {content.count('[ed_fig ')} tiles, {content.count('[ed_chart ')} charts" + (f"; WARNING: 'pilot' appears {len(bad)} times" if bad else ''))


if __name__ == '__main__':
    for iso in (sys.argv[1:] or ['BGD', 'HND', 'KEN', 'KHM', 'PAK']):
        convert(iso.upper())
