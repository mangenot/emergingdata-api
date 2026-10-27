// GET /api/status[?country=BGD][&format=csv]
// One line per series held in the database: first and last observation, number of months, the indicator's
// expected frequency and whether the series is stale (last observation older than the tolerance for that
// frequency). Reads the series_status view (sql/views.sql).
import { sb, authorized, send, fail, codes } from './_lib.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!authorized(req)) return fail(res, 401, 'invalid or missing api key');
  const countries = codes(req.query.country);
  try {
    const filter = countries.length ? `&iso3=in.(${countries.join(',')})` : '';
    const rows = await sb(`series_status?select=*&order=iso3,indicator_code${filter}`);
    const out = rows.map(r => ({
      country: r.iso3, indicator: r.indicator_code, name: r.name, section: r.section_code, frequency: r.frequency,
      first: r.first_obs, last: r.last_obs, rows: Number(r.n_obs), last_vintage: r.last_vintage,
      days_since_last: r.days_since_last, tolerance_days: r.tolerance_days, stale: r.stale,
    }));
    const wrapper = o => ({ generated: new Date().toISOString().slice(0, 10), count: o.length,
                            stale: o.filter(x => x.stale).length, series: o });
    return send(res, req, out, ['country', 'indicator', 'name', 'section', 'frequency', 'first', 'last', 'rows',
                                'last_vintage', 'days_since_last', 'tolerance_days', 'stale'], 'status.csv', wrapper);
  } catch (e) {
    return fail(res, 502, e.message);
  }
}
