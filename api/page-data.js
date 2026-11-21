// GET /api/page-data?country=HND[&sector=APP][&from=2019-01]
// Everything a country report page needs in one call, for the site's ED Reports plugin: the country's series since
// 2019 (monthly series with blanks for gaps, dated points for the others), the text-valued indicators (ratings,
// preference status), the latest scores with the engine's inputs, the benchmark rows of every scored country, the
// currency figures of the page (nominal and real twelve-month moves, the wage in dollars) and the real exchange
// rate index. The same rules as the site generator (site/fetch_data.py and site/build_pages.py).
import { sb, sbAll, authorized, fail, codes, isoDate } from './_lib.js';

const US_INFLATION = 3.0;                                   // US prices taken at 3% a year, as in the scores
const PARTIAL_MONTH = new Set(['POL_UNREST', 'POL_UNREST_SHARE']);   // counts over the month: the current month is incomplete
const BENCH_CODES = ['LAB_SECW', 'LAB_MINW', 'TRD_APP_EXP', 'EXT_GDEBT', 'FX_USD'];

const ym = d => String(d).slice(0, 7);
const addMonths = (s, n) => { const t = Number(s.slice(0, 4)) * 12 + Number(s.slice(5, 7)) - 1 + n; return `${String(Math.floor(t / 12)).padStart(4, '0')}-${String(t % 12 + 1).padStart(2, '0')}`; };
const monthsBetween = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
const round = (v, d = 2) => v === null || v === undefined ? null : Math.round(v * 10 ** d) / 10 ** d;
const num = v => { if (v === null || v === undefined) return null; const r = round(v, 2); return r === 0 && v !== 0 ? round(v, 4) : r; };   // two decimals, four when that gives 0

// A monthly series {start, every, values} (blanks as null) or dated points {points: [[ym, value], ...]}.
// Weekly and daily observations are reduced to the last of each month; a monthly slot holding quarterly data
// (more than 30% gaps) is kept as points.
function buildSeries(obs, frequency) {
  let nums = obs.filter(o => o.value !== null).map(o => [o.date, num(o.value)]);
  if (!nums.length) return null;
  if (frequency === 'weekly' || frequency === 'daily') {
    const m = {};
    for (const [d, v] of nums) m[ym(d)] = v;
    nums = Object.keys(m).sort().map(k => [k, m[k]]);
    frequency = 'monthly';
  }
  const regular = frequency === 'monthly' || (!['quarterly', 'annual', 'irregular'].includes(frequency) && nums.every(([d]) => d.slice(8, 10) === '01') && nums.length >= 12);
  if (regular) {
    const start = ym(nums[0][0]), last = ym(nums[nums.length - 1][0]);
    const values = new Array(monthsBetween(start, last) + 1).fill(null);
    for (const [d, v] of nums) values[monthsBetween(start, ym(d))] = v;
    if (values.filter(v => v === null).length <= 0.3 * values.length) return { start, every: 1, values };
  }
  return { points: nums.map(([d, v]) => [ym(d), v]) };
}

function last(s) {
  if (!s) return [null, null];
  if (s.points) { const p = s.points[s.points.length - 1]; return [p[1], p[0]]; }
  for (let i = s.values.length - 1; i >= 0; i--) if (s.values[i] !== null) return [s.values[i], addMonths(s.start, i)];
  return [null, null];
}

// The value of a monthly series at or before a month.
function at(s, ymv) {
  if (!s || !s.values) return [null, null];
  let i = Math.min(monthsBetween(s.start, ymv), s.values.length - 1);
  while (i >= 0 && s.values[i] === null) i--;
  return i >= 0 ? [s.values[i], addMonths(s.start, i)] : [null, null];
}

// Real exchange rate index: local currency per USD deflated by the local CPI and inflated by US prices at 3% a
// year; Jan 2020 = 100; a rise means cheaper in dollars. The price index is chained from the y/y CPI rate.
function realRate(S) {
  const fx = S.FX_USD, cpi = S.INF_CPI;
  if (!fx || !fx.values || !cpi || !cpi.values) return null;
  const n = fx.values.length, P = [];
  for (let i = 0; i < n; i++) {
    const [pi] = at(cpi, addMonths(fx.start, i));
    if (pi === null) P.push(i ? P[i - 1] : 100);
    else if (i < 12) P.push(i === 0 ? 100 : P[i - 1] * (1 + pi / 100) ** (1 / 12));
    else P.push(P[i - 12] * (1 + pi / 100));
  }
  const raw = fx.values.map((v, i) => v === null ? null : v * (1 + US_INFLATION / 100) ** (i / 12) / P[i]);
  let b = monthsBetween(fx.start, '2020-01');
  if (b < 0 || b >= n || raw[b] === null) b = raw.findIndex(v => v !== null);
  const base = raw[b];
  return { start: addMonths(fx.start, b), every: 1, values: raw.slice(b).map(v => v === null ? null : round(v / base * 100, 2)) };
}

// The figures of the currency block: the twelve-month nominal and real moves and the wage in dollars.
function currencyFigures(S, meta, currency, dollarised) {
  const fx = S.FX_USD;
  if (!fx || !fx.values) return null;
  let i = fx.values.length - 1;
  while (i >= 0 && fx.values[i] === null) i--;
  if (i < 0) return null;
  const now = fx.values[i], when = addMonths(fx.start, i);
  const ago = i >= 12 ? fx.values[i - 12] : null, m1 = i >= 1 ? fx.values[i - 1] : null;
  const dep12 = ago ? (now / ago - 1) * 100 : null, dep1 = m1 ? (now / m1 - 1) * 100 : null;
  const [pi] = at(S.INF_CPI, when);
  const realDep = (ago && pi !== null) ? ((now / ago) * (1 + US_INFLATION / 100) / (1 + pi / 100) - 1) * 100 : null;
  // the wage: the sector wage where one exists, else the general minimum wage; the latest level converted at the
  // latest exchange rate, the level of a year earlier at the rate of twelve months earlier (the scores' convention)
  let wage = null;
  for (const code of ['LAB_SECW', 'LAB_MINW']) {
    const w = S[code];
    if (!w) continue;
    const [wNow, mNow] = last(w);
    if (wNow === null) continue;
    const agoMonth = addMonths(when, -12);
    let wAgo = null, mAgo = null;
    if (w.points) { const p = w.points.filter(q => q[0] <= agoMonth); if (p.length) { mAgo = p[p.length - 1][0]; wAgo = p[p.length - 1][1]; } }
    else [wAgo, mAgo] = at(w, agoMonth);
    const usd = dollarised || currency === 'USD';     // the wage is set in dollars (Cambodia)
    const fNow = usd ? 1 : now, fAgo = usd ? 1 : ago;
    const uNow = fNow ? wNow / fNow : null, uAgo = (wAgo !== null && fAgo) ? wAgo / fAgo : null;
    wage = { code, label: (meta[code] || {}).name || code, local: wNow, month: mNow, local_ago: wAgo, month_ago: mAgo, now: round(uNow, 2), ago: round(uAgo, 2), chg: (uNow && uAgo) ? round((uNow / uAgo - 1) * 100, 2) : null, currency: usd ? 'USD' : currency };
    break;
  }
  return { now: num(now), when, dep12: round(dep12), dep1: round(dep1), cpi: pi, real_dep: round(realDep), real_move: realDep === null ? null : round(-realDep), wage, code: currency };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!authorized(req)) return fail(res, 401, 'invalid or missing api key');
  const iso = codes(req.query.country)[0];
  if (!iso) return fail(res, 400, 'country is required, e.g. ?country=HND');
  const sector = codes(req.query.sector)[0] || 'APP';
  const from = isoDate(req.query.from, '2019-01-01');
  const thisMonth = new Date().toISOString().slice(0, 7);
  try {
    const [countries, indicators, obs, comps, scores, sections, benchObs] = await Promise.all([
      sb('country?select=iso3,name,currency,fx_regime'),
      sb('indicator?select=code,name,unit,frequency,section_code'),
      sbAll(`observation_latest?select=indicator_code,obs_date,value,text_value&iso3=eq.${iso}&obs_date=gte.${from}&order=indicator_code,obs_date`),
      sb(`composite?select=iso3,score_date,cost_pressure,disruption_risk,cost_trend,risk_trend,note&sector_code=eq.${sector}&order=iso3,score_date.desc`),
      sb(`score?select=iso3,section_code,score_date,cost_score,risk_score,cost_trend,risk_trend,note&sector_code=eq.${sector}&order=iso3,score_date.desc,section_code&limit=5000`),
      sb('section?select=code,name,sort_order&order=sort_order'),
      sb(`observation_latest?select=iso3,indicator_code,obs_date,value&indicator_code=in.(${BENCH_CODES.join(',')})&obs_date=gte.2023-01-01&order=iso3,indicator_code,obs_date&limit=5000`),
    ]);
    const country = countries.find(c => c.iso3 === iso);
    if (!country) return fail(res, 404, `unknown country ${iso}`);
    const meta = Object.fromEntries(indicators.map(m => [m.code, m]));
    const names = Object.fromEntries(countries.map(c => [c.iso3, c]));

    // series and facts of the country
    const byCode = {};
    for (const o of obs) {
      if (PARTIAL_MONTH.has(o.indicator_code) && ym(o.obs_date) >= thisMonth) continue;
      (byCode[o.indicator_code] ||= []).push({ date: o.obs_date, value: o.value === null ? null : Number(o.value), text: o.text_value });
    }
    const series = {}, facts = {}, used = {};
    for (const code of Object.keys(byCode).sort()) {
      const rows = byCode[code];
      const texts = rows.filter(r => r.value === null && r.text);
      if (texts.length) facts[code] = { name: (meta[code] || {}).name || code, values: texts.map(t => ({ date: t.date, text: t.text })) };
      const s = buildSeries(rows, (meta[code] || {}).frequency || '');
      if (s) { series[code] = s; used[code] = { name: (meta[code] || {}).name || code, unit: (meta[code] || {}).unit || null, frequency: (meta[code] || {}).frequency || null }; }
    }
    const fxReal = realRate(series);
    const dollarised = /dollari/i.test(country.fx_regime || '');          // the engine's rule: the wage is set in dollars
    const currency = currencyFigures(series, meta, country.currency || 'USD', dollarised);

    // scores: latest month per country, with the engine's inputs
    const parse = n => { try { return n ? JSON.parse(n) : null; } catch { return n; } };
    const latest = {};
    for (const c of comps) if (!latest[c.iso3]) latest[c.iso3] = c.score_date;
    const scoreRow = iso3 => {
      const comp = comps.find(c => c.iso3 === iso3 && c.score_date === latest[iso3]);
      if (!comp) return null;
      const secs = scores.filter(s => s.iso3 === iso3 && s.score_date === latest[iso3]);
      return {
        country: iso3, sector, score_date: latest[iso3],
        cost_pressure: comp.cost_pressure === null ? null : Number(comp.cost_pressure), cost_trend: comp.cost_trend,
        disruption_risk: comp.disruption_risk === null ? null : Number(comp.disruption_risk), risk_trend: comp.risk_trend,
        composite_detail: parse(comp.note),
        sections: sections.map(sec => {
          const s = secs.find(x => x.section_code === sec.code) || {};
          const n = parse(s.note);
          return { section: sec.code, name: sec.name, cost: s.cost_score ?? null, cost_trend: s.cost_trend || null, risk: s.risk_score ?? null, risk_trend: s.risk_trend || null, inputs: n ? n.inputs : null, notes: n ? n.notes : null };
        }),
      };
    };

    // benchmark rows: every scored country of the sector
    const bo = {};
    for (const o of benchObs) ((bo[o.iso3] ||= {})[o.indicator_code] ||= []).push({ date: o.obs_date, value: o.value === null ? null : Number(o.value) });
    const lastYear = String(new Date().getFullYear() - 1);
    const bench = Object.keys(latest).sort().map(iso3 => {
      const sc = scoreRow(iso3);
      const inp = Object.fromEntries((sc ? sc.sections : []).map(s => [s.section, s.inputs || {}]));
      const lab = inp.LAB || {}, inf = inp.INF || {}, ext = inp.EXT || {}, fx = inp.FX || {}, trd = inp.TRD || {}, fin = inp.FIN || {};
      const o = bo[iso3] || {};
      const cur = (names[iso3] || {}).currency || '';
      let wageLocal = (cur === 'USD' || /dollari/i.test((names[iso3] || {}).fx_regime || '')) ? 'set in USD' : '';
      for (const code of ['LAB_SECW', 'LAB_MINW']) {
        const rows = (o[code] || []).filter(r => r.value !== null);
        if (rows.length && !wageLocal) { wageLocal = `${cur} ${Math.round(rows[rows.length - 1].value).toLocaleString('en-US')}`; break; }
      }
      const app = (o.TRD_APP_EXP || []).filter(r => r.value !== null);
      let app12 = null, appChg = null, appDate = '';
      if (app.length) {
        const vals = Object.fromEntries(app.map(r => [ym(r.date), r.value]));
        const lastM = ym(app[app.length - 1].date);
        const w1 = [...Array(12).keys()].map(k => vals[addMonths(lastM, -k)]);
        const w2 = [...Array(12).keys()].map(k => vals[addMonths(lastM, -12 - k)]);
        if (w1.every(v => v !== undefined)) {
          app12 = Math.round(w1.reduce((a, b) => a + b, 0));
          if (w2.every(v => v !== undefined) && w2.reduce((a, b) => a + b, 0)) appChg = round((w1.reduce((a, b) => a + b, 0) / w2.reduce((a, b) => a + b, 0) - 1) * 100, 1);
          appDate = `to ${monthLabel(lastM)}`;
        }
      }
      const gds = (o.EXT_GDEBT || []).filter(r => r.value !== null && r.date.slice(0, 4) <= lastYear);
      const gd = gds[gds.length - 1];
      const market = String(trd.main_market || 'US').split(' ')[0];
      return {
        iso: iso3, name: (names[iso3] || {}).name || iso3,
        cost: sc ? sc.cost_pressure : null, costT: (sc && sc.cost_trend) || 'stable', risk: sc ? sc.disruption_risk : null, riskT: (sc && sc.risk_trend) || 'stable',
        wage: lab.wage_usd ?? null, wageLocal,
        cpi: typeof inf.INF_CPI === 'number' ? round(inf.INF_CPI) : null, cpiDate: monthLabel(inf.INF_CPI_date),
        moi: ext.EXT_RES_MOI ?? null, dep: fx.depreciation_12m ?? null,
        market, tariff: trd[market === 'EU' ? 'TRD_TARIFF_EU' : 'TRD_TARIFF_US'] ?? null,
        npl: fin.FIN_NPL ?? null, nplDate: monthLabel(fin.FIN_NPL_date),
        app: app12, appChg, appDate,
        gdebt: gd ? round(gd.value, 1) : null, gdebtY: gd ? gd.date.slice(0, 4) : '',
      };
    });

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).json({
      country: iso, name: country.name, currency: country.currency, fx_regime: country.fx_regime, sector,
      generated: new Date().toISOString(), from,
      series, fx_real: fxReal, currency_figures: currency, indicators: used, facts,
      scores: scoreRow(iso), bench,
    });
  } catch (e) {
    return fail(res, 502, e.message);
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthLabel(ymv) {
  if (!ymv) return '';
  return `${MONTHS[Number(String(ymv).slice(5, 7)) - 1]} ${String(ymv).slice(0, 4)}`;
}
