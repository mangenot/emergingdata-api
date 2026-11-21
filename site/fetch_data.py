#!/usr/bin/env python3
"""Pull the country series, scores and benchmark inputs from the EmergingData API into data/, so that a page build
starts from the database as it stands that morning.

    python3 fetch_data.py [ISO ...]            all five countries when none is given
    ED_API_BASE   the API base, default https://emergingdata-api.vercel.app
    ED_API_KEY    optional client key, sent as the x-api-key header (never printed)

Writes, per country: data/<ISO>_series.txt (the monthly and dated series, the format read by build_pages.py),
data/<ISO>_facts.json (text-valued indicators: ratings, preferences, IMF status, with their dates),
data/<ISO>_scores.json (the latest scores with the engine's inputs and notes); and across countries data/bench.json
(the benchmark table) and data/fetch_meta.json (what was fetched and when). Hand overrides of a series go in
data/overrides/<ISO>_series.txt and are merged by build_pages.py after every fetch, so a fetch never loses them."""
import json, os, sys, urllib.request, urllib.parse, urllib.error, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data')
BASE = os.environ.get('ED_API_BASE', 'https://emergingdata-api.vercel.app').rstrip('/')
KEY = os.environ.get('ED_API_KEY', '')
COUNTRIES = ['BGD', 'HND', 'KEN', 'KHM', 'PAK']
NAMES = {'BGD': 'Bangladesh', 'HND': 'Honduras', 'KEN': 'Kenya', 'KHM': 'Cambodia', 'PAK': 'Pakistan'}
CURRENCY = {'BGD': 'BDT', 'HND': 'HNL', 'KEN': 'KES', 'KHM': 'USD', 'PAK': 'PKR'}
FROM = '2019-01-01'
PARTIAL_MONTH = {'POL_UNREST', 'POL_UNREST_SHARE'}   # counts over the month: the current month is incomplete and left out


def get(path, **params):
    url = f"{BASE}{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={'Accept': 'application/json', **({'x-api-key': KEY} if KEY else {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode('utf-8'))


def ym(d):
    return d[:7]


def add_months(ymd, n):
    y, m = int(ymd[:4]), int(ymd[5:7])
    t = y * 12 + m - 1 + n
    return f"{t // 12:04d}-{t % 12 + 1:02d}"


def months_between(a, b):
    return (int(b[:4]) - int(a[:4])) * 12 + int(b[5:7]) - int(a[5:7])


def fmt(v):
    v = float(v)
    if v == int(v):
        return str(int(v))
    r = round(v, 2)
    return repr(r if r != 0 else round(v, 4))


def build_series(obs, frequency):
    """A monthly series as 'start|v1,v2,...' (gaps blank), or dated points for the other frequencies.
    Weekly and daily series are reduced to the last observation of each month."""
    nums = [(o['date'], o['value']) for o in obs if o['value'] is not None]
    if not nums:
        return None
    if frequency in ('weekly', 'daily'):
        bym = {}
        for d, v in nums:
            bym[ym(d)] = v  # observations come ordered by date: the last of the month wins
        nums = sorted(bym.items())
        frequency = 'monthly'
    if frequency == 'monthly' or (frequency not in ('quarterly', 'annual', 'irregular') and all(d[8:10] == '01' for d, _ in nums) and len(nums) >= 12):
        start, last = ym(nums[0][0]), ym(nums[-1][0])
        vals = [None] * (months_between(start, last) + 1)
        for d, v in nums:
            vals[months_between(start, ym(d))] = v
        if sum(v is None for v in vals) <= 0.3 * len(vals):   # a monthly series; sparse ones (quarterly data in a monthly slot) go as dated points
            return f"{start}|" + ','.join('' if v is None else fmt(v) for v in vals)
    return 'irregular|' + ','.join(f"{ym(d)}={fmt(v)}" for d, v in nums)


def fetch_country(iso):
    status = get('/api/status', country=iso)
    series_meta = {s['indicator']: s for s in status['series']}
    codes = sorted(series_meta)
    observations = []
    for i in range(0, len(codes), 8):          # small batches: the database answers at most 1,000 rows per request
        batch = codes[i:i + 8]
        r = get('/api/series', country=iso, indicator=','.join(batch), **{'from': FROM})
        observations += r['observations']
    by_code = {}
    this_month = datetime.date.today().strftime('%Y-%m')
    for o in observations:
        if o['indicator'] in PARTIAL_MONTH and ym(o['date']) >= this_month:
            continue
        by_code.setdefault(o['indicator'], []).append(o)
    lines, facts, count, last = [], {}, 0, ''
    for code in codes:
        obs = by_code.get(code, [])
        texts = [(o['date'], o['text_value']) for o in obs if o['value'] is None and o['text_value']]
        if texts:
            facts[code] = dict(name=series_meta[code]['name'], values=[dict(date=d, text=t) for d, t in texts])
        line = build_series(obs, series_meta[code]['frequency'] or '')
        if line:
            lines.append(f"{code}|{line}")
            count += 1
            if not line.startswith('irregular'):
                last = max(last, series_meta[code]['last'] or '')
    hdr = f"# {NAMES[iso]} ({iso}): {count} series fetched on {datetime.date.today().isoformat()} from {BASE}; overrides in data/overrides/{iso}_series.txt"
    open(os.path.join(DATA, f'{iso}_series.txt'), 'w', encoding='utf-8').write(hdr + '\n' + '\n'.join(lines) + '\n')
    json.dump(facts, open(os.path.join(DATA, f'{iso}_facts.json'), 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    scores = get('/api/scores', country=iso, detail='1')
    json.dump(scores, open(os.path.join(DATA, f'{iso}_scores.json'), 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    return dict(series=count, last=last, stale=status.get('stale'), score_date=(scores['countries'][0]['score_date'] if scores.get('countries') else None), by_code=by_code)


def latest(obs_list, numeric=True):
    xs = [o for o in obs_list if (o['value'] is not None if numeric else o['text_value'])]
    return xs[-1] if xs else None


def bench_row(iso, info, scores_all):
    """The benchmark line of a country from the scoring inputs and the series."""
    sc = next((c for c in scores_all['countries'] if c['country'] == iso), None)
    S = info['by_code']
    inp = {}
    if sc:
        for s in sc['sections']:
            inp[s['section']] = s.get('inputs') or {}
    lab, inf, ext, fx, trd, fin = (inp.get(k, {}) for k in ('LAB', 'INF', 'EXT', 'FX', 'TRD', 'FIN'))
    # local wage: the sector wage where one exists, else the general minimum wage
    wage_local = 'set in USD' if iso == 'KHM' else ''
    for code in ('LAB_SECW', 'LAB_MINW'):
        w = latest(S.get(code, []))
        if w and not wage_local:
            wage_local = f"{CURRENCY[iso]} {w['value']:,.0f}"
            break
    app = latest(S.get('TRD_APP_EXP', []))
    app12 = chg = None
    if app:
        vals = {ym(o['date']): o['value'] for o in S['TRD_APP_EXP'] if o['value'] is not None}
        last = ym(app['date'])
        w1 = [vals.get(add_months(last, -k)) for k in range(12)]
        w2 = [vals.get(add_months(last, -k)) for k in range(12, 24)]
        if all(v is not None for v in w1):
            app12 = round(sum(w1))
            if all(v is not None for v in w2) and sum(w2):
                chg = round((sum(w1) / sum(w2) - 1) * 100, 1)
    # public debt: the last actual year (the WEO series runs on into projections)
    year = str(datetime.date.today().year - 1)
    gds = [o for o in S.get('EXT_GDEBT', []) if o['value'] is not None and o['date'][:4] <= year]
    gd = gds[-1] if gds else None
    market = str(trd.get('main_market', 'US')).split(' ')[0]
    tariff = trd.get('TRD_TARIFF_EU' if market == 'EU' else 'TRD_TARIFF_US')
    return dict(iso=iso, name=NAMES[iso],
                cost=sc['cost_pressure'] if sc else None, costT=(sc['cost_trend'] if sc else 'stable') or 'stable',
                risk=sc['disruption_risk'] if sc else None, riskT=(sc['risk_trend'] if sc else 'stable') or 'stable',
                wage=lab.get('wage_usd'), wageLocal=wage_local,
                cpi=round(inf['INF_CPI'], 2) if isinstance(inf.get('INF_CPI'), (int, float)) else None, cpiDate=month_label(inf.get('INF_CPI_date')),
                moi=ext.get('EXT_RES_MOI'), dep=fx.get('depreciation_12m'),
                market=market, tariff=tariff,
                npl=fin.get('FIN_NPL'), nplDate=month_label(fin.get('FIN_NPL_date')),
                app=app12, appChg=chg, appDate=f"to {month_label(ym(app['date']))}" if app else '',
                gdebt=round(gd['value'], 1) if gd else None, gdebtY=gd['date'][:4] if gd else '')


MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']


def month_label(ymv):
    if not ymv:
        return ''
    return f"{MONTHS[int(ymv[5:7]) - 1]} {ymv[:4]}"


def main(isos):
    os.makedirs(DATA, exist_ok=True)
    os.makedirs(os.path.join(DATA, 'overrides'), exist_ok=True)
    meta = dict(fetched=datetime.date.today().isoformat(), base=BASE, countries={})
    infos = {}
    for iso in isos:
        info = fetch_country(iso)
        infos[iso] = info
        meta['countries'][iso] = dict(series=info['series'], last=info['last'], stale=info['stale'], score_date=info['score_date'])
        print(f"{iso}: {info['series']} series to {info['last']}, scores of {info['score_date']}")
    scores_all = get('/api/scores', detail='1')
    json.dump(scores_all, open(os.path.join(DATA, 'scores_all.json'), 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    bench_path = os.path.join(DATA, 'bench.json')
    bench = {b['iso']: b for b in (json.load(open(bench_path, encoding='utf-8')) if os.path.exists(bench_path) else [])}
    for iso in isos:
        bench[iso] = bench_row(iso, infos[iso], scores_all)
    json.dump([bench[k] for k in sorted(bench)], open(bench_path, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    json.dump(meta, open(os.path.join(DATA, 'fetch_meta.json'), 'w', encoding='utf-8'), indent=1)
    print('benchmark rows:', ', '.join(sorted(bench)))


if __name__ == '__main__':
    main([a.upper() for a in sys.argv[1:]] or COUNTRIES)
