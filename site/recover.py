#!/usr/bin/env python3
"""Rebuild specs/<iso>.py and data/<ISO>_series.txt from a published page (published/<iso>.html).
The pages carry everything: text, tiles, risks, facts, sources and the DATA JSON (series, charts, events, scores)."""
import re, json, sys, os, pprint
from bs4 import BeautifulSoup, NavigableString, Tag

HERE = os.path.dirname(os.path.abspath(__file__))
NAMES = {'BGD': 'Bangladesh', 'KEN': 'Kenya', 'KHM': 'Cambodia', 'PAK': 'Pakistan', 'HND': 'Honduras'}
SECTION_KEYS = {'Public finances and external position': 'FIN', 'Exports, imports and tariffs': 'EXT',
                'Politics, social climate and labour costs': 'POL', 'Logistics and shipping costs': 'LOG', 'Energy costs': 'ENE'}
CURRENCY = {
    'BGD': dict(code='BDT', wage=dict(now=(12500, '2026-09'), year_ago=(12500, '2025-09'), label='garment minimum wage, Tk 12,500')),
    'KEN': dict(code='KES', wage=dict(now=(18047.40, '2026-09'), year_ago=(16113.75, '2025-09'), label='general minimum wage, cities')),
    'PAK': dict(code='PKR', wage=dict(now=(40700, '2026-09'), year_ago=(40000, '2025-09'), label='federal minimum wage')),
    'KHM': dict(code='KHR', wage=dict(now=(210, '2026-10'), year_ago=(208, '2025-10'), label='garment minimum wage, set in dollars', currency='USD')),
    'HND': dict(code='HNL', wage=dict(now=(12930.07, '2026-09'), year_ago=(11972, '2025-09'), label='maquila wage scale')),
}
CLASS_DIR = {'up': 'up', 'flat': 'flat', 'down': 'down'}


def inner(tag):
    """The inner HTML of a tag, entities as in the source where the parser kept them."""
    return ''.join(str(c) for c in tag.contents)


def fix_entities(s):
    """BeautifulSoup decodes entities; put back the ones the specs used in the source so the round trip is exact."""
    s = s.replace('−', '&minus;').replace('&', '&amp;').replace('&amp;minus;', '&minus;')
    # BeautifulSoup already re-escapes & < > in str(); undo the double escaping of a literal &amp;
    s = s.replace('&amp;amp;', '&amp;')
    return s


def raw_inner(html_src, tag):
    """Find the tag's exact source text in the page to keep entities as written."""
    return None


def text_of(p):
    """The HTML text of a p.text, split on <br> into sentences."""
    return [t for t in inner(p).split('<br/>')]


def parse_trend(tr):
    divs = tr.find_all('div', recursive=False)
    first, second = divs[0], divs[1]
    d = first.select_one('.d')['class'][1]
    when = None
    h = first.select_one('.h')
    if h:
        when = h.get_text().strip('()')
        h.extract()
    first.select_one('.d').extract()
    change = inner(first).strip()
    labels = tuple(x.get_text() for x in second.select('.h'))
    ds = [x['class'][1] for x in second.select('.d')]
    return dict(dir=d, change=change, when=when, short=ds[0], long=ds[1], labels=labels)


def parse_fig(fig):
    label = fig.select_one('.label').get_text()
    v = fig.select_one('.v')
    unit = None
    sm = v.find('small')
    if sm:
        unit = sm.get_text()
        sm.extract()
    value = inner(v)
    if value == '&ndash;' or value == '–':
        value = None
    note = inner(fig.select_one('.s'))
    tr = fig.select_one('.trend')
    out = dict(label=label, value=value)
    if unit:
        out['unit'] = unit
    out['note'] = note
    if tr:
        t = parse_trend(tr)
        if t['when'] and t['labels'] == ('3 m', '12 m'):
            out['code'] = LABEL_CODES.get(label, '?' + label)
        else:
            if not t['when']:
                t.pop('when')
            if t['labels'] == ('short', 'long'):
                t.pop('labels')
            out['trend'] = t
    return out


LABEL_CODES = {'Exchange rate': 'FX_USD', 'Reserves': 'EXT_RES', 'Inflation': 'INF_CPI', 'Policy rate': 'FIN_POLICY', 'Central Bank Rate': 'FIN_POLICY',
               'Remittances': 'EXT_REMIT', 'Protest events': 'POL_UNREST', 'Apparel exports to the US': 'TRD_APP_EXP', 'Apparel exports': 'TRD_APP_EXP',
               'Exports, all goods': 'TRD_EXP', 'Imports': 'TRD_IMP', 'Credit growth': 'FIN_CREDIT'}


def parse_section(sec):
    out = {}
    out['lead'] = inner(sec.select_one('p.concl'))
    texts = sec.select('p.text')
    blocks = sec.select('h3.block')
    currency = None
    if blocks and blocks[0].get_text() == 'The currency':
        # the currency block: h3, p.text, figs, charts, h3 (then)
        cur_text = texts[0]
        currency = dict(text=text_of(cur_text), then=blocks[1].get_text())
        rate_fig = sec.select_one('.figs .fig')
        v = rate_fig.select_one('.v')
        currency['rate'] = dict(value=inner(v), note=inner(rate_fig.select_one('.s')))
        texts = texts[1:]
        figs_divs = sec.select('div.figs')[1:]
    else:
        figs_divs = sec.select('div.figs')
    if len(texts) == 1:
        out['text'] = text_of(texts[0])
    else:
        out['text'] = '</p><p class="text">'.join(inner(t) for t in texts).replace('<br/>', '<br>')
    ul = sec.select_one('ul.updates')
    ups = []
    if ul:
        for li in ul.find_all('li', recursive=False):
            d = li.select_one('.d')['class'][1]
            li.select_one('.d').extract()
            ups.append((d, inner(li)))
    out['updates'] = [u for u in ups if not u[1].startswith('The currency over twelve months')]
    figs = []
    for fd in figs_divs:
        for fig in fd.find_all('div', class_='fig', recursive=False):
            f = parse_fig(fig)
            if f['label'] not in ('Import cost in local currency', 'Export cost in dollars'):
                figs.append(f)
    out['figs'] = figs
    ch = sec.select('div.charts')
    ch = [c for c in ch if c.get('data-charts') != 'FX_USD,FX_REAL']
    out['charts'] = ch[0]['data-charts'].split(',') if ch else []
    risks = []
    for r in sec.select('.riskgrid .risk'):
        lvl = r['class'][1]
        rh = r.select_one('.rh')
        title = inner(rh.find('strong'))
        horizon = inner(rh.select_one('.when'))
        ps = r.find_all('p', recursive=False)
        text = inner(ps[0])
        watch = None
        for p in ps[1:]:
            if 'watch' in p.get('class', []):
                p.select_one('.label').extract()
                watch = inner(p)
        risks.append(dict(level=lvl, title=title, horizon=horizon, text=text, watch=watch))
    out['risks'] = risks
    gap = sec.select_one('p.gap')
    gap.find('strong').extract()
    out['gap'] = inner(gap).strip()
    return out, currency


def parse(iso):
    src = open(os.path.join(HERE, 'published', f'{iso.lower()}.html'), encoding='utf-8').read()
    m = re.search(r'<script>\nvar DATA = (.*?);\n', src, re.S)
    data = json.loads(m.group(1))
    body = src[src.index('<div class="page">'):src.index('<script>')]
    soup = BeautifulSoup(body, 'lxml')
    spec = dict(iso=iso, name=soup.select_one('h1').get_text(), title=f"{NAMES[iso]} Apparel Profile",
                sub=soup.select_one('.title .sub').get_text(), meta=inner(soup.select_one('.title .meta')))
    ov = soup.select_one('section.overview')
    if ov:
        paras, cur = [], (None, [])
        for el in ov.select_one('.ovbody').children:
            if isinstance(el, Tag) and el.name == 'h3':
                if cur[1]:
                    paras.append(cur)
                cur = (el.get_text(), [])
            elif isinstance(el, Tag) and el.name == 'p':
                cur[1].append(inner(el))
        if cur[1]:
            paras.append(cur)
        spec['overview'] = dict(date=ov.select_one('h2 .date').get_text(), standfirst=inner(ov.select_one('.standfirst')),
                                paras=paras, byline=inner(ov.select_one('p.small')))
    sections, order, currency = {}, [], None
    for sec in soup.select('section.chapter'):
        h2 = sec.select_one('h2')
        h2.select_one('.n').extract()
        key = SECTION_KEYS[h2.get_text().strip()]
        order.append(key)
        sections[key], cur = parse_section(sec)
        if cur:
            currency = cur
    spec['order'] = order
    if currency:
        c = dict(CURRENCY[iso])
        c.update(currency)
        spec['currency'] = c
    spec['sections'] = sections
    facts = []
    for div in soup.select('.facts dl > div'):
        facts.append((div.find('dt').get_text(), inner(div.find('dd'))))
    spec['facts'] = facts
    spec['scores'] = data['SCORES']
    charts = {k: v for k, v in data['CHARTS'].items() if k != 'FX_REAL'}
    spec['charts'] = charts
    spec['events'] = data['EVENTS']
    spec['sources'] = [inner(li) for li in soup.select('.method ul')[1].find_all('li')]
    # series file
    lines = []
    for code, s in data['SERIES'].items():
        if code == 'FX_REAL':
            continue
        if 'values' in s:
            lines.append(f"{code}|{s['start']}|" + ','.join('' if v is None else fmt_num(v) for v in s['values']))
        else:
            lines.append(f"{code}|irregular|" + ','.join(f"{d}={fmt_num(v)}" for d, v in s['points']))
    open(os.path.join(HERE, 'data', f'{iso}_series.txt'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    return spec


def fmt_num(v):
    if v == int(v):
        return str(int(v))
    return repr(v)


def write_spec(iso, spec):
    txt = pprint.pformat(spec, width=160, sort_dicts=False)
    hdr = f'"""EmergingData country report spec: {NAMES[iso]}, November 2026 edition. Recovered from the published page on 21 November 2026."""\n'
    open(os.path.join(HERE, 'specs', f'{iso.lower()}.py'), 'w', encoding='utf-8').write(hdr + 'SPEC = ' + txt + '\n')


if __name__ == '__main__':
    for iso in (sys.argv[1:] or ['PAK', 'BGD', 'KEN', 'KHM', 'HND']):
        spec = parse(iso)
        write_spec(iso, spec)
        print(iso, 'sections', list(spec['sections']), 'figs', sum(len(s['figs']) for s in spec['sections'].values()))
