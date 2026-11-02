// GET /api/score-run?key=<ED_RELAY_SECRET>[&date=2026-11-01][&country=KEN,BGD][&dry=1]
// Runs the scoring engine (api/_scoring.js) on the pilot countries as of the first day of a month and writes the
// section scores (score table) and the two apparel composites (composite table), one row per country, section and
// month; running again for the same month overwrites that month. dry=1 computes without writing.
// Also run by the Vercel cron on the 5th of each month (vercel.json), which sends Authorization: Bearer CRON_SECRET.
import { sb, sbAll, sbUpsert, fail } from './_lib.js';
import { scoreCountry, rankCountries, latestValues, addMonths } from './_scoring.js';

const SECTOR = 'APP';

function allowed(req) {
  const secret = process.env.ED_RELAY_SECRET || '', cron = process.env.CRON_SECRET || '';
  const key = String(req.query.key || req.headers['x-relay-key'] || '');
  const auth = String(req.headers['authorization'] || '');
  if (secret && key === secret) return true;
  if (cron && auth === `Bearer ${cron}`) return true;
  return false;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!allowed(req)) return fail(res, 401, 'needs key=ED_RELAY_SECRET or the cron secret');
  const today = new Date().toISOString().slice(0, 10);
  const asOf = /^\d{4}-\d{2}/.test(String(req.query.date || '')) ? String(req.query.date).slice(0, 7) + '-01' : today.slice(0, 7) + '-01';
  const dry = String(req.query.dry || '') === '1';
  const only = String(req.query.country || '').toUpperCase().split(',').map(s => s.trim()).filter(Boolean);
  try {
    let countries = (await sb('country?select=iso3,name,currency,fx_regime,peer_group&proposal=eq.Pilot&order=iso3')).filter(c => c.iso3 !== 'WLD');
    if (only.length) countries = countries.filter(c => only.includes(c.iso3));
    if (!countries.length) return fail(res, 400, 'no pilot country matches');
    const isoList = `in.(${countries.map(c => c.iso3).join(',')})`;
    const from = addMonths(asOf, -84);
    const [obs, events, weights] = await Promise.all([
      sbAll(`observation_latest?select=iso3,indicator_code,obs_date,value,text_value,note&iso3=${isoList}&obs_date=gte.${from}&obs_date=lte.${asOf}&order=iso3,indicator_code,obs_date`),
      sbAll(`event?select=iso3,event_type,event_date,description,verify&iso3=${isoList}&order=event_date`),
      sb(`weight?select=composite,component,weight&sector_code=eq.${SECTOR}`),
    ]);
    const obsBy = {}, evBy = {};
    for (const o of obs) (obsBy[o.iso3] = obsBy[o.iso3] || []).push(o);
    for (const e of events) (evBy[e.iso3] = evBy[e.iso3] || []).push(e);
    // a country is scored only once it has the exchange rate or the inflation series loaded
    countries = countries.filter(c => (obsBy[c.iso3] || []).some(o => o.indicator_code === 'FX_USD' || o.indicator_code === 'INF_CPI'));
    if (!countries.length) return fail(res, 400, 'no pilot country has data yet');
    // ranks across the covered countries for the quintile rules: always over every pilot, whatever the filter
    const allPilots = only.length ? (await sb('country?select=iso3,name,currency,fx_regime&proposal=eq.Pilot')).filter(c => c.iso3 !== 'WLD') : countries;
    let obsAll = obsBy;
    if (only.length) {
      const rest = allPilots.filter(c => !obsBy[c.iso3]);
      if (rest.length) {
        const more = await sbAll(`observation_latest?select=iso3,indicator_code,obs_date,value,text_value,note&iso3=in.(${rest.map(c => c.iso3).join(',')})&indicator_code=in.(INF_CPI,LAB_SECW,LAB_MINW,FX_USD)&obs_date=gte.${from}&obs_date=lte.${asOf}`);
        obsAll = { ...obsBy }; for (const o of more) (obsAll[o.iso3] = obsAll[o.iso3] || []).push(o);
      }
    }
    const ranks = { INF_CPI: rankCountries(latestValues(allPilots, obsAll, asOf, 'INF_CPI')), WAGE_USD: rankCountries(latestValues(allPilots, obsAll, asOf, 'WAGE_USD')) };

    const results = countries.map(c => scoreCountry(c, obsBy[c.iso3] || [], evBy[c.iso3] || [], weights, asOf, ranks));
    const scoreRows = [], compRows = [];
    for (const r of results) {
      for (const [sec, s] of Object.entries(r.sections)) {
        scoreRows.push({ iso3: r.iso3, sector_code: SECTOR, section_code: sec, score_date: asOf, cost_score: s.cost, risk_score: s.risk,
                         cost_trend: s.costTrend, risk_trend: s.riskTrend, note: JSON.stringify({ inputs: s.inputs, notes: s.notes }) });
      }
      compRows.push({ iso3: r.iso3, sector_code: SECTOR, score_date: asOf, cost_pressure: r.composite.cost_pressure, disruption_risk: r.composite.disruption_risk,
                      cost_trend: r.composite.cost_trend, risk_trend: r.composite.risk_trend,
                      note: JSON.stringify({ cost: r.composite.cost_detail, risk: r.composite.risk_detail, derived: r.derived }) });
    }
    let written = { score: 0, composite: 0 };
    if (!dry) {
      written.score = await sbUpsert('score', scoreRows, 'iso3,sector_code,section_code,score_date');
      written.composite = await sbUpsert('composite', compRows, 'iso3,sector_code,score_date');
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      score_date: asOf, sector: SECTOR, dry, written, ranks,
      countries: results.map(r => ({
        country: r.iso3,
        cost_pressure: r.composite.cost_pressure, cost_trend: r.composite.cost_trend,
        disruption_risk: r.composite.disruption_risk, risk_trend: r.composite.risk_trend,
        sections: Object.fromEntries(Object.entries(r.sections).map(([k, s]) => [k, { cost: s.cost, cost_trend: s.costTrend, risk: s.risk, risk_trend: s.riskTrend, inputs: s.inputs, notes: s.notes }])),
        composite_detail: { cost: r.composite.cost_detail, risk: r.composite.risk_detail }, derived: r.derived,
      })),
    });
  } catch (e) {
    return fail(res, 502, e.message);
  }
}
