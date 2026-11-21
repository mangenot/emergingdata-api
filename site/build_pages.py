#!/usr/bin/env python3
"""EmergingData country report pages: one HTML page per country from a spec (specs/<iso>.py) and the series files
(data/<ISO>_series.txt). Usage: python3 build_pages.py [--fetch] [ISO ...]; --fetch first pulls the series, scores and
benchmark from the API (fetch_data.py). Writes <iso>-profile.html (artifact page, no document skeleton) and
dist/<Name>-Apparel-Profile-2026-11.html (standalone, printable).

Spec format (see specs/pak.py): overview (date, standfirst, paras as (heading or None, [paragraphs]), byline),
currency (code, rate, wage, text, then), order of the five sections and sections[key] with lead, text (one sentence
per item), updates [(dir, text)], figs [dict(label, value, unit, note, code | trend)], risks, charts, gap; then facts,
scores, charts, events, sources."""
import json, sys, os, re, importlib.util, html

HERE = os.path.dirname(os.path.abspath(__file__))
EDITION = 'November 2026 edition'
TODAY = '2026-11-04'
US_INFLATION = 3.0
MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

BENCH = [
    dict(iso='BGD', name='Bangladesh', cost=2.11, costT='down', risk=3.0, riskT='stable', wage=101.67, wageLocal='BDT 12,500', cpi=8.26, cpiDate='Aug 2026', moi=4.9, dep=1.0, market='EU', tariff=0, npl=30.6, nplDate='Dec 2025', app=38701, appChg=-1.6, appDate='to Jun 2026', gdebt=42.0, gdebtY='2025'),
    dict(iso='HND', name='Honduras', cost=3.25, costT='stable', risk=2.07, riskT='up', wage=481.02, wageLocal='HNL 12,930', cpi=6.53, cpiDate='Jun 2026', moi=7.7, dep=3.0, market='US', tariff=0, npl=None, nplDate='', app=1901, appChg=-10.3, appDate='to Aug 2026', gdebt=40.3, gdebtY='2025'),
    dict(iso='KEN', name='Kenya', cost=2.38, costT='down', risk=2.33, riskT='stable', wage=139.32, wageLocal='KES 18,047', cpi=6.76, cpiDate='Sep 2026', moi=6.5, dep=0.2, market='US', tariff=0, npl=13.9, nplDate='Sep 2026', app=625, appChg=3.1, appDate='to Aug 2026', gdebt=71.3, gdebtY='2025'),
    dict(iso='KHM', name='Cambodia', cost=4.0, costT='stable', risk=2.2, riskT='down', wage=210, wageLocal='set in USD', cpi=4.79, cpiDate='Aug 2026', moi=7.3, dep=1.0, market='US', tariff=27, npl=None, nplDate='', app=12014, appChg=5.3, appDate='to Oct 2026', gdebt=25.5, gdebtY='2025'),
    dict(iso='PAK', name='Pakistan', cost=2.88, costT='up', risk=2.73, riskT='down', wage=144.29, wageLocal='PKR 40,000', cpi=10.26, cpiDate='Sep 2026', moi=5.7, dep=-1.6, market='EU', tariff=0, npl=5.5, nplDate='Jun 2026', app=8992, appChg=3.2, appDate='to Sep 2026', gdebt=72.8, gdebtY='2025'),
]

# The five sections in the editor's order, with the chapter title and the short name used in the contents line.
SECTIONS = {
    'FIN': ('Public finances and external position', 'Finances'),
    'EXT': ('Exports, imports and tariffs', 'External trade'),
    'POL': ('Politics, social climate and labour costs', 'Politics and labour'),
    'LOG': ('Logistics and shipping costs', 'Logistics'),
    'ENE': ('Energy costs', 'Energy'),
}
DEFAULT_ORDER = ['FIN', 'EXT', 'POL', 'LOG', 'ENE']

# The global block shared by every page, written once a month.
GLOBAL = [
    ('Oil', 'Brent averaged USD 107 a barrel in October, 7% above September and 68% above a year earlier. The jump came in March 2026, from 69 to 96 dollars, and the price has stayed above 80 since; fuel surcharges, power tariffs and polyester prices follow with a lag of one to six months.'),
    ('Freight', 'The Drewry World Container Index stood at USD 4,429 per 40ft container on 29 October, down 3% on the week after two weeks of rises: Shanghai to Los Angeles USD 7,514 (&minus;6%), Shanghai to New York 9,631 (&minus;5%), Shanghai to Rotterdam 3,686 (+1%), Shanghai to Genoa 4,151 (stable). Drewry expects rates to ease as US import volumes fall in November.'),
    ('Demand', 'US apparel imports were USD 7.2 billion in August, 0.5% above August 2025 by value and 6% lower by volume. EU-27 clothing imports were EUR 8.4 billion in August, up 7% on a year earlier by value and 2.5% by volume.'),
    ('Tariffs', 'The US Section 301 forced-labour duties of 24 July 2026 (10% on most of the sixty economies) replaced the Section 122 surcharge; CAFTA-DR apparel is exempt and the AGOA countries are not covered. The textile tariff-rate quotas announced for Bangladesh and Cambodia are not established. The new EU GSP regulation applies from 1 January 2027.'),
]

# Codes whose changes are read in points, not per cent.
RATE_CODES = {'INF_CPI', 'FIN_POLICY', 'FIN_CREDIT', 'FIN_NPL', 'FIN_LEND', 'FX_REAL_CHG'}
ARROW = {'up': '&#9650;', 'flat': '&#9654;', 'down': '&#9660;'}
WORD = {'up': 'rising', 'flat': 'stable', 'down': 'falling'}
DIR_ORDER = {'up': 0, 'flat': 1, 'down': 2}


# ---------------------------------------------------------------- series and arithmetic
def read_series_file(path, S):
    """Lines 'code|start|v1,v2,...' (monthly, blanks for gaps) or 'code|irregular|YYYY-MM=v,...'; '#' comments."""
    if not os.path.exists(path):
        return S
    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            code, start, vals = line.split('|', 2)
            if start == 'irregular':
                pts = [(p.split('=')[0], p.split('=')[1]) for p in vals.split(',')]
                try:
                    nums = [(d, float(v)) for d, v in pts]
                except ValueError:
                    continue
                S[code] = dict(points=nums)
            else:
                S[code] = dict(start=start, every=1, values=[float(v) if v != '' else None for v in vals.split(',')])
    return S


def load_series(iso):
    """The fetched series (data/<ISO>_series.txt, written by fetch_data.py) with the hand overrides of
    data/overrides/<ISO>_series.txt applied on top, code by code."""
    S = read_series_file(os.path.join(HERE, 'data', f'{iso}_series.txt'), {})
    return read_series_file(os.path.join(HERE, 'data', 'overrides', f'{iso}_series.txt'), S)


def load_json(name):
    path = os.path.join(HERE, 'data', name)
    return json.load(open(path, encoding='utf-8')) if os.path.exists(path) else None


TREND_WORD = {'up': 'up', 'down': 'down', 'stable': 'stable', None: 'stable'}
SECTION_INPUT_LABELS = [
    ('next_election', 'election {}'), ('POL_SANCTIONS', 'sanctions {}'), ('POL_CPI_TI', 'corruption index {}'), ('POL_UNREST_ratio', 'unrest {} times the average'),
    ('main_market', 'main market {}'), ('TRD_TARIFF_US', 'US tariff {}%'), ('TRD_TARIFF_EU', 'EU tariff {}%'), ('TRD_DEST_US', 'US share {}%'), ('TRD_DEST_EU', 'EU share {}%'), ('next_pref_review', 'preference review {}'),
    ('EXT_RES_MOI', '{} months of imports'), ('EXT_RATING', 'rating {}'), ('EXT_IMF', 'IMF {}'),
    ('depreciation_12m', 'depreciation {}%'), ('FX_VOL', 'volatility {}%'), ('real_depreciation_12m', 'real depreciation {}%'),
    ('INF_CPI', 'inflation {}%'), ('INF_CPI_3m_avg', '3-month average {}'), ('rank_among_covered', 'rank {} of 5'),
    ('FIN_LEND', 'lending rate {}%'), ('FIN_POLICY', 'policy rate {}% plus 4'), ('FIN_NPL', 'NPL {}%'),
    ('wage_usd', 'wage USD {}'), ('wage_usd_change_12m', 'up {}% in USD'), ('next_wage_review', 'wage review {}'), ('LAB_STRIKES', 'strikes {}'),
    ('ENV_ELEC', 'electricity {} US c/kWh'), ('ENV_OUTAGE', 'outages {} h/month'),
]


def section_note(sec):
    """A short line of the inputs behind a section score, from the engine's inputs and notes."""
    inputs = sec.get('inputs') or {}
    parts = []
    for key, label in SECTION_INPUT_LABELS:
        if key in inputs and inputs[key] is not None:
            v = inputs[key]
            if isinstance(v, float):
                v = f"{round(v, 2):g}"
            elif isinstance(v, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', v):
                v = f"{int(v[8:10])} {MONTHS[int(v[5:7]) - 1]} {v[:4]}"
            elif isinstance(v, str) and len(v) > 70:
                v = v[:67].rstrip() + '...'
            parts.append(label.format(v).replace(' -', ' \u2212').replace('(-', '(\u2212'))
    if not parts:
        notes = sec.get('notes') or []
        parts = [n.split(':')[0] for n in notes[:2]] or ['no series loaded']
    return '; '.join(parts)


def scores_from_api(iso, fallback):
    """The SCORES block of the page from data/<ISO>_scores.json (fetch_data.py), else the spec's own."""
    raw = load_json(f'{iso}_scores.json')
    if not raw or not raw.get('countries'):
        return fallback
    c = raw['countries'][0]
    sections = [[s['section'], s['name'], s.get('cost'), TREND_WORD.get(s.get('cost_trend'), 'stable'), s.get('risk'), TREND_WORD.get(s.get('risk_trend'), 'stable'), section_note(s)]
                for s in c['sections'] if s['section'] != 'GLB']   # the global drivers are not a country score
    cd = c.get('composite_detail') or {}

    def cov(part, label):
        d = cd.get(part) or {}
        covered = d.get('covered')
        pct = f"{covered * 100:.0f}%" if isinstance(covered, (int, float)) and covered <= 1 else (f"{covered:.0f}%" if isinstance(covered, (int, float)) else '')
        miss = d.get('missing') or []
        return f"{label} {pct} of the weight" + (f" (missing {', '.join(miss)})" if miss else '')
    cov_text = f"Composite coverage: {cov('cost', 'cost')}, {cov('risk', 'risk')}; the covered components are renormalised." if cd else fallback.get('cov', '')
    return dict(cost=c.get('cost_pressure'), costT=TREND_WORD.get(c.get('cost_trend'), 'stable'), risk=c.get('disruption_risk'), riskT=TREND_WORD.get(c.get('risk_trend'), 'stable'),
                sections=sections, cov=cov_text, date=c.get('score_date'))


def bench_from_api(fallback):
    rows = load_json('bench.json')
    return rows if rows else fallback


def add_months(ym, n):
    y, m = int(ym[:4]), int(ym[5:7])
    t = y * 12 + m - 1 + n
    return f"{t // 12:04d}-{t % 12 + 1:02d}"


def month_label(ym):
    return f"{MONTHS[int(ym[5:7]) - 1]} {ym[:4]}"


def esc(s):
    return html.escape(str(s), quote=True)


def minus(s):
    """Text for a trend line: the &minus; entity and a hyphen before a digit become the Unicode minus, then escaped."""
    return esc(re.sub(r'(?<![\w])-(?=\d)', '−', str(s).replace('&minus;', '−')))


def signed(x, d=1, unit='%'):
    return ('+' if x >= 0 else '−') + f"{abs(x):.{d}f}{unit}"


def pct(x, d=1):
    return signed(x, d, '%')


def direction(d, rate=False, thr=None):
    if d is None:
        return 'flat'
    thr = thr if thr is not None else (0.15 if rate else 1.0)
    return 'flat' if abs(d) < thr else ('up' if d > 0 else 'down')


def series_at(S, code, ym):
    """Value of a monthly series at or before the month ym, with the month found."""
    s = S.get(code)
    if not s or 'values' not in s:
        return None, None
    i = (int(ym[:4]) - int(s['start'][:4])) * 12 + int(ym[5:7]) - int(s['start'][5:7])
    vals = s['values']
    i = min(i, len(vals) - 1)
    while i >= 0 and vals[i] is None:
        i -= 1
    return (vals[i], add_months(s['start'], i)) if i >= 0 else (None, None)


def series_trend(S, code):
    """Trend of a monthly series: change on the month, and direction over 3 and 12 months (latest against the value
    three and twelve months earlier). Rates in points with a 0.15 point threshold, levels in per cent with 1%."""
    s = S.get(code)
    if not s or 'values' not in s:
        return None
    vals = s['values']
    idx = [k for k, v in enumerate(vals) if v is not None]
    if not idx:
        return None
    i = idx[-1]
    rate = code in RATE_CODES
    now, when = vals[i], add_months(s['start'], i)

    def chg(a, b):
        if a is None or b is None:
            return None
        return (a - b) if rate else ((a / b - 1) * 100 if b else None)

    mm = chg(now, vals[i - 1] if i >= 1 else None)
    d3 = chg(now, vals[i - 3] if i >= 3 else None)
    d12 = chg(now, vals[i - 12] if i >= 12 else None)
    if mm is None:
        return None
    change = signed(mm, 1, ' pts' if rate else '%') + ' on the month'
    return dict(dir=direction(mm, rate), change=change, when=month_label(when),
                short=direction(d3, rate), long=direction(d12, rate), labels=('3 m', '12 m'))


# ---------------------------------------------------------------- the currency block
def real_rate_series(S):
    """Real exchange rate index: local currency per USD, deflated by the local CPI and inflated by US prices at 3% a
    year; Jan 2020 = 100; a rise means cheaper in dollars. The local price index is chained from the y/y CPI rate,
    the first year spread evenly."""
    fx, cpi = S.get('FX_USD'), S.get('INF_CPI')
    if not fx or not cpi or 'values' not in fx or 'values' not in cpi:
        return None
    start = fx['start']
    n = len(fx['values'])
    P = []
    for i in range(n):
        ym = add_months(start, i)
        pi, _ = series_at(S, 'INF_CPI', ym)
        if pi is None:
            P.append(P[i - 1] if i else 100.0)
        elif i < 12:
            P.append(100.0 if i == 0 else P[i - 1] * (1 + pi / 100) ** (1 / 12))
        else:
            P.append(P[i - 12] * (1 + pi / 100))
    raw = [None if fx['values'][i] is None else fx['values'][i] * (1 + US_INFLATION / 100) ** (i / 12) / P[i] for i in range(n)]
    b = (2020 - int(start[:4])) * 12 + 1 - int(start[5:7])
    if b < 0 or b >= n or raw[b] is None:
        b = next(i for i, v in enumerate(raw) if v is not None)
    base = raw[b]
    return dict(start=add_months(start, b), every=1, values=[None if v is None else round(v / base * 100, 2) for v in raw[b:]])


def currency_figures(spec, S):
    fx = S.get('FX_USD')
    if not fx:
        return None
    vals = fx['values']
    i = max(k for k, v in enumerate(vals) if v is not None)
    now, when = vals[i], add_months(fx['start'], i)
    ago = vals[i - 12] if i >= 12 and vals[i - 12] is not None else None
    m1 = vals[i - 1] if i >= 1 else None
    dep12 = (now / ago - 1) * 100 if ago else None
    dep1 = (now / m1 - 1) * 100 if m1 else None
    pi, _ = series_at(S, 'INF_CPI', when)
    real_dep = ((now / ago) * (1 + US_INFLATION / 100) / (1 + pi / 100) - 1) * 100 if (ago and pi is not None) else None
    cur = spec.get('currency') or {}
    w = cur.get('wage')
    wage = None
    if w:
        (a_now, m_now), (a_ago, m_ago) = w['now'], w['year_ago']
        if w.get('currency') == 'USD':
            usd_now, usd_ago = a_now, a_ago
        else:
            f_now, _ = series_at(S, 'FX_USD', m_now)
            f_ago, _ = series_at(S, 'FX_USD', m_ago)
            usd_now, usd_ago = (a_now / f_now if f_now else None), (a_ago / f_ago if f_ago else None)
        wage = dict(now=usd_now, ago=usd_ago, chg=((usd_now / usd_ago - 1) * 100 if usd_now and usd_ago else None), label=w.get('label', 'minimum wage'))
    return dict(now=now, when=when, dep12=dep12, dep1=dep1, cpi=pi, real_dep=real_dep, wage=wage, code=cur.get('code', 'local currency'))


def currency_html(spec, S, F):
    """The block at the head of section 1: a heading, the text of the spec, four tiles and the two currency charts."""
    cur = spec.get('currency') or {}
    rate = cur.get('rate') or {}
    figs = []
    figs.append(dict(label='Exchange rate', value=rate.get('value', f"{F['now']:,.2f}"), note=rate.get('note', f"{F['code']} per USD, {month_label(F['when'])}"), code='FX_USD'))
    if F['dep12'] is not None:
        figs.append(dict(label='Nominal move, 12 months', value=pct(F['dep12']),
                         note=('weaker' if F['dep12'] >= 0 else 'stronger') + f" against the dollar, to {month_label(F['when'])}",
                         trend=dict(dir=direction(F['dep12'], thr=0.5), change=pct(F['dep1']) + ' on the month' if F['dep1'] is not None else '', short='flat', long='flat')))
    if F['real_dep'] is not None:
        move = -F['real_dep']
        figs.append(dict(label='Real move, 12 months', value=pct(move),
                         note=('dearer' if move >= 0 else 'cheaper') + f" in dollars; local inflation {F['cpi']:.1f}% against 3% in the US",
                         trend=dict(dir=direction(move, thr=0.5), change='local costs in dollars, real terms', short='flat', long='flat')))
    w = F.get('wage')
    if w and w['now']:
        figs.append(dict(label='Minimum wage in dollars', value=f"USD {w['now']:,.0f}", unit='a month',
                         note=f"{w['label']}; USD {w['ago']:,.0f} a year earlier" if w['ago'] else w['label'],
                         trend=dict(dir=direction(w['chg'], thr=0.5), change=pct(w['chg']) + ' on a year earlier', short='flat', long='up') if w['chg'] is not None else None))
    text = cur.get('text') or []
    out = '<h3 class="block">The currency</h3>'
    if text:
        out += f'<p class="text">{lines(text)}</p>'
    out += f'<div class="figs">{"".join(fig_html(f, S) for f in figs)}</div>'
    out += '<div class="charts" data-charts="FX_USD,FX_REAL"></div>'
    return out


def trade_currency_tiles(F):
    figs, update = [], None
    if F['dep12'] is not None:
        figs.append(dict(label='Import cost in local currency', value=pct(F['dep12']), unit='12 m', note='a dollar of inputs, nominal rate',
                         trend=dict(dir=direction(F['dep12'], thr=0.5), change=f"to {month_label(F['when'])}", short='flat', long='flat')))
    if F['real_dep'] is not None:
        move = -F['real_dep']
        figs.append(dict(label='Export cost in dollars', value=pct(move), unit='12 m', note='local costs in dollars, real rate',
                         trend=dict(dir=direction(move, thr=0.5), change=f"local inflation {F['cpi']:.1f}%", short='flat', long='flat')))
        d = F['dep12']
        if abs(d) < 0.5:
            head = 'unchanged against the dollar'
        else:
            head = (f"{abs(d):.1f}% weaker against the dollar, so a dollar of imported inputs costs {abs(d):.1f}% more in local currency" if d > 0
                    else f"{abs(d):.1f}% stronger against the dollar, so a dollar of imported inputs costs {abs(d):.1f}% less in local currency")
        update = (direction(move, thr=0.5),
                  f"The currency over twelve months: {head}; with local inflation at {F['cpi']:.1f}%, local costs in dollars are {abs(move):.1f}% "
                  + ('higher' if move >= 0 else 'lower') + " in real terms.")
    return figs, update


# ---------------------------------------------------------------- html pieces
def lines(items):
    """One sentence per line: the items joined by <br>. A string is passed through."""
    if isinstance(items, str):
        return items
    return '<br>'.join(items)


def trend_html(tr):
    if not tr:
        return ''
    a, b = tr.get('labels', ('short', 'long'))
    when = f' <span class="h">({esc(tr["when"])})</span>' if tr.get('when') else ''
    return (f'<div class="trend"><div><span class="d {tr["dir"]}">{ARROW[tr["dir"]]}</span> {minus(tr.get("change", ""))}{when}</div>'
            f'<div><span class="h">{a}</span> <span class="d {tr["short"]}">{ARROW[tr["short"]]}</span> {WORD[tr["short"]]} &middot; '
            f'<span class="h">{b}</span> <span class="d {tr["long"]}">{ARROW[tr["long"]]}</span> {WORD[tr["long"]]}</div></div>')


def fig_html(f, S=None):
    if isinstance(f, (list, tuple)):
        label, value, unit, note = (list(f) + ['', ''])[:4]
        f = dict(label=label, value=value, unit=unit, note=note)
    value = f.get('value')
    v = value if value not in (None, '') else '&ndash;'
    tr = f.get('trend')
    if not tr and f.get('code') and S is not None:
        tr = series_trend(S, f['code'])
    return (f'<div class="fig"><span class="label">{esc(f["label"])}</span><div class="v">{v}'
            + (f'<small>{esc(f["unit"])}</small>' if f.get('unit') else '') + f'</div><div class="s">{f.get("note", "")}</div>'
            + trend_html(tr) + '</div>')


def updates_html(ups):
    if not ups:
        return ''
    ups = sorted(ups, key=lambda u: DIR_ORDER.get(u[0], 1))
    return '<ul class="updates">' + ''.join(f'<li><span class="d {d}">{ARROW[d]}</span>{t}</li>' for d, t in ups) + '</ul>'


def risks_html(risks):
    if not risks:
        return ''
    out = '<div class="risks"><h3>Risks ahead</h3><div class="riskgrid">'
    for r in risks:
        lvl = r['level']
        out += (f'<div class="risk {lvl}"><div class="rh"><span class="pill {lvl}">{lvl.capitalize()}</span><strong>{r["title"]}</strong>'
                f'<span class="when">{r["horizon"]}</span></div><p>{r["text"]}</p>'
                + (f'<p class="watch"><span class="label">Watch</span>{r["watch"]}</p>' if r.get('watch') else '') + '</div>')
    return out + '</div></div>'


def overview_html(ov):
    if not ov:
        return ''
    body = ''
    for heading, paras in ov.get('paras', []):
        if heading:
            body += f'<h3>{esc(heading)}</h3>'
        body += ''.join(f'<p>{p}</p>' for p in paras)
    return f'''
  <section class="report overview" id="overview">
    <h2>Overview <span class="date num">{esc(ov["date"])}</span></h2>
    <p class="standfirst">{ov["standfirst"]}</p>
    <div class="ovbody">{body}</div>
    <p class="small">{ov["byline"]}</p>
  </section>
'''


def sections_of(spec):
    """The five sections in the spec's order; old seven-chapter specs are merged into them."""
    if 'sections' in spec:
        order = spec.get('order') or DEFAULT_ORDER
        return [(k, spec['sections'][k]) for k in order]
    ch = spec['chapters']  # 1 politics, 2 tariffs, 3 labour, 4 finances, 5 logistics, 6 energy, 7 shipping

    def merged(parts):
        out = dict(lead=parts[0]['concl'], text=parts[0]['text'], figs=[], charts=[], gap='')
        texts, gaps = [], []
        for p in parts:
            texts.append(p['text'])
            out['figs'] += p['figs']
            out['charts'] += p.get('charts', [])
            if p.get('gap'):
                gaps.append(p['gap'].rstrip('.'))
        out['text'] = '</p><p class="text">'.join(texts)
        out['gap'] = '; '.join(gaps) + '.' if gaps else ''
        if len(parts) > 1:
            out['lead'] = ' '.join(p['concl'] for p in parts)
        return out
    secs = {'FIN': merged([ch[3]]), 'EXT': merged([ch[1]]), 'POL': merged([ch[0], ch[2]]), 'LOG': merged([ch[4], ch[6]]), 'ENE': merged([ch[5]])}
    return [(k, secs[k]) for k in DEFAULT_ORDER]


WCI_FALLBACK = dict(value='USD 4,429', unit='/40ft', note='29 Oct 2026, &minus;3% on the week (Drewry)',
                    trend=dict(dir='down', change='-3% on the week', short='up', long='down'))


def render(spec):
    S = load_series(spec['iso'])
    css = open(os.path.join(HERE, 'template.css'), encoding='utf-8').read().rstrip('\n')
    js = open(os.path.join(HERE, 'template.js'), encoding='utf-8').read().rstrip('\n')
    charts_spec = dict(spec['charts'])
    rr = real_rate_series(S)
    F = None
    if rr:
        S['FX_REAL'] = rr
        code = (spec.get('currency') or {}).get('code', 'local currency')
        charts_spec['FX_REAL'] = dict(title='Real exchange rate',
                                      unit=f"{code} per USD adjusted for the inflation differential with the US (US inflation taken at three per cent a year, as in the scores), index Jan 2020 = 100; a rise means cheaper in dollars",
                                      decimals=1, tickDecimals=0, series=[dict(name='Real rate', code='FX_REAL')])
        F = currency_figures(spec, S)

    chapters_html = []
    for num, (key, sec) in enumerate(sections_of(spec), 1):
        title = SECTIONS[key][0]
        figs = list(sec.get('figs', []))
        updates = list(sec.get('updates', []))
        block, head = '', ''
        if key == 'FIN' and F:
            block = currency_html(spec, S, F)
            figs = [f for f in figs if (f['label'] if isinstance(f, dict) else f[0]) != 'Exchange rate']
            then = (spec.get('currency') or {}).get('then', 'Public finances and the banks')
            head = f'<h3 class="block">{esc(then)}</h3>'
        if key == 'EXT' and F:
            tf, upd = trade_currency_tiles(F)
            figs = tf + figs
            if upd:
                updates = [upd] + updates
        for f in figs:
            if isinstance(f, dict) and f.get('label') == 'World Container Index' and not f.get('value'):
                f.update(WCI_FALLBACK)
        charts = f'<div class="charts" data-charts="{",".join(sec.get("charts", []))}"></div>' if sec.get('charts') else ''
        chapters_html.append(f'''
  <section class="chapter" id="c{num}">
    <h2><span class="n">{num}</span>{esc(title)}</h2>
    <p class="concl">{sec['lead']}</p>
    {block}{head}
    <p class="text">{lines(sec['text'])}</p>
    {updates_html(updates)}
    <div class="figs">{''.join(fig_html(f, S) for f in figs)}</div>
    {charts}
    {risks_html(sec.get('risks'))}
    <p class="gap"><strong>To add:</strong> {sec['gap']}</p>
  </section>''')

    facts_cols = spec['facts']
    half = (len(facts_cols) + 1) // 2
    facts_html = ''.join('<dl>' + ''.join(f'<div><dt>{esc(dt)}</dt><dd>{dd}</dd></div>' for dt, dd in col) + '</dl>'
                         for col in (facts_cols[:half], facts_cols[half:]))
    sources_html = ''.join(f'<li>{s}</li>' for s in spec['sources'])
    order = [k for k, _ in sections_of(spec)]
    contents = ''.join(f'<a href="#c{n}">{n} {SECTIONS[k][1]}</a>' for n, k in enumerate(order, 1))
    global_html = ''.join(f'<div><span class="label">{esc(l)}</span>{t}</div>' for l, t in GLOBAL)
    ov = spec.get('overview')
    fm = load_json('fetch_meta.json') or {}
    fc = (fm.get('countries') or {}).get(spec['iso'])
    if fc:
        d = fm['fetched']
        series_note = f"{int(d[8:10])} {MONTH_NAMES[int(d[5:7]) - 1]} {d[:4]} ({fc['series']} series)"
    else:
        series_note = f"4 November 2026 ({len(S)} series)"
    meta = spec['meta'].replace('{series}', series_note)
    scores = scores_from_api(spec['iso'], spec['scores'])
    data = dict(ISO=spec['iso'], TODAY=TODAY, SCORES=scores, BENCH=bench_from_api(BENCH), SERIES=S, CHARTS=charts_spec, EVENTS=spec['events'])
    page = f'''<title>{esc(spec['title'])}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,400;0,600;0,700;1,400&family=Source+Serif+4:opsz,wght@8..60,500;8..60,600&display=swap">
<style>
{css}
</style>

<div class="page">
  <header class="mast">
    <div class="brand"><span class="wordmark">EmergingData</span><span>Country report</span><span class="tag">Prototype</span></div>
    <div class="edition">{EDITION}</div>
  </header>

  <section class="title">
    <h1>{esc(spec['name'])}</h1>
    <p class="sub">{esc(spec['sub'])}</p>
    <p class="meta num">{meta}</p>
    <nav class="contents" aria-label="Contents">
{'<a href="#overview">Overview</a>' if ov else ''}<a href="#global">Global context</a>{contents}<a href="#facts">Standing facts</a><a href="#benchmark">Benchmark</a><a href="#scores">Scores</a>
    </nav>
  </section>

{overview_html(ov)}

  <section class="report" id="global">
    <h2>Global context this month <span class="draft">Draft</span></h2>
    <p class="small">One block shared by every country page, written once a month from the global series (EmergingTextiles workbooks through the API).</p>
    <div class="context">{global_html}</div>
  </section>
{''.join(chapters_html)}


  <section class="appendix" id="facts">
    <h2>Standing facts</h2>
    <p class="lede">Statuses that change by event rather than by month. Those marked "verify" are awaiting a check and are not yet used in the scores.</p>
    <div class="facts">{facts_html}</div>
  </section>

  <section class="appendix" id="benchmark">
    <h2>Macro benchmark</h2>
    <p class="lede">The five countries of the November edition, ordered by cost pressure. {esc(spec['name'])} is highlighted.</p>
    <div class="scroll"><table id="bench"></table></div>
    <p class="foot">Wage: the garment sector wage where one exists, otherwise the general minimum wage, converted at the September 2026 exchange rate. Public debt: general government, fiscal 2025, IMF WEO. Apparel exports: twelve months to the last month available; US imports from OTEXA for Kenya and Honduras, national customs data for Bangladesh, Cambodia and Pakistan, so the two groups are not comparable in scope. Tariff: on the main destination market, US or EU. Real move: the twelve-month change against the dollar corrected for the inflation differential with the US (US inflation taken at 3% a year, as in the scores); a positive figure means local costs became dearer in dollars.</p>
  </section>

  <section class="appendix" id="scores">
    <h2>Scores</h2>
    <p class="lede">The scoring engine's reading of 1 November 2026, by section, with the two composites. Cost: 1 lowest pressure on the sourcing cost, 5 highest. Risk: 1 lowest disruption risk, 5 highest. The arrow compares with the inputs of three to six months earlier.</p>
    <div class="comps" id="comps"></div>
    <div class="scroll"><table class="scores" id="sectable"></table></div>
    <p class="foot">{scores['cov']}</p>
  </section>

  <section class="appendix">
    <h2>Method and sources</h2>
    <div class="method">
      <div>
        <h3 class="label">Method</h3>
        <ul>
          <li>Each section opens with its introduction and a short analysis, then the month's updates and the figures behind them with their direction; the "to add" line names the indicators of the template not loaded yet.</li>
          <li>Dated events (elections, wage reviews, preference dates) feed the scores but are not listed on the page.</li>
          <li>The scores in the appendix follow published rules on one or two inputs each; ranks (inflation, wage) are among the five countries covered.</li>
          <li>Scores are frozen on the first day of the month from the data available that day; the chapters show the latest data, so a figure can be newer than the score.</li>
          <li>Values marked "verify" are awaiting a check and are not used in the scores.</li>
        </ul>
      </div>
      <div>
        <h3 class="label">Sources</h3>
        <ul>{sources_html}</ul>
      </div>
    </div>
  </section>

  <footer>EmergingData country report, {esc(spec['name'])}, apparel. Prototype built from the EmergingData API on 4 November 2026. Scores of the November 2026 edition.</footer>
</div>

<script>
var DATA = {json.dumps(data, ensure_ascii=False)};
{js}
</script>
'''
    return page


def load_spec(iso):
    path = os.path.join(HERE, 'specs', f'{iso.lower()}.py')
    loader = importlib.util.spec_from_file_location(iso, path)
    mod = importlib.util.module_from_spec(loader)
    loader.loader.exec_module(mod)
    return mod.SPEC


def tile_check(spec, S, seen):
    """Print the tiles whose series has moved to a new month since the last build, so the hand-written value and
    note next to the computed trend can be updated; data/last_build.json remembers what each build saw."""
    iso = spec['iso']
    prev = seen.get(iso, {})
    now = {}
    moved = []
    for key, sec in sections_of(spec):
        for f in sec.get('figs', []):
            code = f.get('code') if isinstance(f, dict) else None
            if not code or code not in S or 'values' not in S[code]:
                continue
            vals = S[code]['values']
            idx = [k for k, v in enumerate(vals) if v is not None]
            if not idx:
                continue
            last = add_months(S[code]['start'], idx[-1])
            now[code] = dict(last=last, value=vals[idx[-1]])
            if prev.get(code, {}).get('last') != last or prev.get(code, {}).get('value') != vals[idx[-1]]:
                moved.append(f"  {key} {f['label']}: series {code} now {month_label(last)} = {vals[idx[-1]]:g}; tile says {f.get('value')} ({f.get('note', '')})")
    seen[iso] = now
    if moved:
        print(f"{iso}: {len(moved)} tile(s) whose series moved since the last build")
        print('\n'.join(moved))
    else:
        print(f"{iso}: no tile series moved since the last build")


def main(isos):
    os.makedirs(os.path.join(HERE, 'dist'), exist_ok=True)
    seen = load_json('last_build.json') or {}
    for iso in isos:
        spec = load_spec(iso)
        page = render(spec)
        tile_check(spec, load_series(iso), seen)
        out = os.path.join(HERE, f'{iso.lower()}-profile.html')
        open(out, 'w', encoding='utf-8').write(page)
        standalone = ('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
                      '<style>:root{color-scheme:light}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>' + page + '</body></html>')
        name = spec['name'].replace(' ', '-')
        open(os.path.join(HERE, 'dist', f'{name}-Apparel-Profile-2026-11.html'), 'w', encoding='utf-8').write(standalone)
        if 'pilot' in page.lower().replace('pilot-', ''):
            n = len(re.findall(r'pilot', page, re.I))
            print(f'  warning: the word "pilot" appears {n} times')
        print(iso, len(page), 'bytes ->', out)
    json.dump(seen, open(os.path.join(HERE, 'data', 'last_build.json'), 'w', encoding='utf-8'), indent=1)


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if '--fetch' in sys.argv:
        import fetch_data
        try:
            fetch_data.main([a.upper() for a in args] or fetch_data.COUNTRIES)
        except Exception as e:  # the API unreachable: build from the files on disk and say so
            print(f'fetch failed ({e}); building from the data files on disk')
    main([a.upper() for a in args] or ['KEN', 'BGD', 'PAK', 'KHM', 'HND'])
