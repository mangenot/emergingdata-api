// GET /api/catalog?type=indicators|countries|events[&country=BGD][&format=csv]
// The registry as the database holds it: indicators (code, name, section, unit, frequency, phase),
// countries (iso3, name, peer group, proposal) or events (dated calendar and pushed decisions).
import { sb, authorized, send, fail, codes } from './_lib.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!authorized(req)) return fail(res, 401, 'invalid or missing api key');
  const type = String(req.query.type || 'indicators').toLowerCase();
  const countries = codes(req.query.country);
  try {
    if (type === 'indicators') {
      const rows = await sb('indicator?select=code,name,section_code,sector_code,type,unit,frequency,side,benchmark,phase,default_source&order=section_code,code');
      return send(res, req, rows, ['code', 'name', 'section_code', 'sector_code', 'type', 'unit', 'frequency', 'side', 'benchmark', 'phase', 'default_source'], 'indicators.csv');
    }
    if (type === 'countries') {
      const rows = await sb('country?select=iso3,name,peer_group,proposal,currency,fx_regime,fiscal_year&order=peer_group,name');
      return send(res, req, rows, ['iso3', 'name', 'peer_group', 'proposal', 'currency', 'fx_regime', 'fiscal_year'], 'countries.csv');
    }
    if (type === 'events') {
      const filter = countries.length ? `&iso3=in.(${countries.join(',')})` : '';
      const rows = await sb(`event?select=iso3,event_type,event_date,rhythm,description,sections_hit,source,verify&order=iso3,event_date.desc.nullslast${filter}`);
      return send(res, req, rows, ['iso3', 'event_type', 'event_date', 'rhythm', 'description', 'sections_hit', 'source', 'verify'], 'events.csv');
    }
    return fail(res, 400, 'type must be indicators, countries or events');
  } catch (e) {
    return fail(res, 502, e.message);
  }
}
