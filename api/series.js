// GET /api/series?country=BGD&indicator=INF_CPI[,FX_USD]&from=2024-01&to=2026-12&format=json|csv
// Returns the latest vintage of each observation (observation_latest), with the indicator's name and unit.
// Several countries or indicators may be given as comma-separated lists; CSV is always long format.
import { sb, authorized, send, fail, codes, isoDate } from './_lib.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!authorized(req)) return fail(res, 401, 'invalid or missing api key');
  const countries = codes(req.query.country);
  const indicators = codes(req.query.indicator);
  if (!countries.length || !indicators.length) return fail(res, 400, 'country and indicator are required, e.g. ?country=BGD&indicator=INF_CPI');
  if (countries.length * indicators.length > 50) return fail(res, 400, 'at most 50 country x indicator pairs per request');
  const from = isoDate(req.query.from, '2000-01-01');
  const to = isoDate(req.query.to, '2100-01-01');
  try {
    const inList = a => `in.(${a.join(',')})`;
    const [meta, obs] = await Promise.all([
      sb(`indicator?select=code,name,unit,frequency,section_code,sector_code&code=${inList(indicators)}`),
      sb(`observation_latest?select=iso3,indicator_code,obs_date,value,text_value,vintage_date,note` +
         `&iso3=${inList(countries)}&indicator_code=${inList(indicators)}` +
         `&obs_date=gte.${from}&obs_date=lte.${to}&order=indicator_code,iso3,obs_date&limit=20000`),
    ]);
    const byCode = Object.fromEntries(meta.map(m => [m.code, m]));
    const rows = obs.map(o => ({
      country: o.iso3, indicator: o.indicator_code, date: o.obs_date,
      value: o.value === null ? null : Number(o.value), text_value: o.text_value,
      unit: (byCode[o.indicator_code] || {}).unit || null, vintage: o.vintage_date, note: o.note,
    }));
    const wrapper = r => ({
      query: { country: countries, indicator: indicators, from, to },
      indicators: indicators.map(c => byCode[c] || { code: c, name: null }),
      count: r.length,
      observations: r,
    });
    return send(res, req, rows, ['country', 'indicator', 'date', 'value', 'text_value', 'unit', 'vintage', 'note'],
                `${countries.join('-')}_${indicators.join('-')}.csv`, wrapper);
  } catch (e) {
    return fail(res, 502, e.message);
  }
}
