// GET /api/scores?country=KEN[,BGD][&date=2026-11][&sector=APP][&detail=1][&format=csv]
// The scores of the latest scoring month (or of the month given): the two composites and the nine section scores
// (cost and risk, 1 to 5, with trend arrows). detail=1 adds the inputs and notes behind each score.
// Without country: every scored country.
import { sb, authorized, send, fail, codes, isoDate } from './_lib.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!authorized(req)) return fail(res, 401, 'invalid or missing api key');
  const countries = codes(req.query.country);
  const sector = (codes(req.query.sector)[0] || 'APP');
  const date = isoDate(req.query.date, null);
  const detail = String(req.query.detail || '') === '1';
  try {
    const filt = (countries.length ? `&iso3=in.(${countries.join(',')})` : '') + `&sector_code=eq.${sector}` + (date ? `&score_date=eq.${date}` : '');
    const [comps, scores, sections] = await Promise.all([
      sb(`composite?select=iso3,score_date,cost_pressure,disruption_risk,cost_trend,risk_trend,note&order=iso3,score_date.desc${filt}`),
      sb(`score?select=iso3,section_code,score_date,cost_score,risk_score,cost_trend,risk_trend,note&order=iso3,score_date.desc,section_code${filt}&limit=5000`),
      sb('section?select=code,name,sort_order&order=sort_order'),
    ]);
    const latest = {};
    for (const c of comps) if (!latest[c.iso3]) latest[c.iso3] = c.score_date;     // first row per country = latest month
    const parse = n => { try { return n ? JSON.parse(n) : null; } catch { return n; } };
    const out = Object.keys(latest).sort().map(iso3 => {
      const comp = comps.find(c => c.iso3 === iso3 && c.score_date === latest[iso3]);
      const secs = scores.filter(s => s.iso3 === iso3 && s.score_date === latest[iso3]);
      const row = {
        country: iso3, sector, score_date: latest[iso3],
        cost_pressure: comp.cost_pressure === null ? null : Number(comp.cost_pressure), cost_trend: comp.cost_trend,
        disruption_risk: comp.disruption_risk === null ? null : Number(comp.disruption_risk), risk_trend: comp.risk_trend,
        sections: sections.map(sec => {
          const s = secs.find(x => x.section_code === sec.code) || {};
          const o = { section: sec.code, name: sec.name, cost: s.cost_score ?? null, cost_trend: s.cost_trend || null, risk: s.risk_score ?? null, risk_trend: s.risk_trend || null };
          if (detail) { const n = parse(s.note); o.inputs = n ? n.inputs : null; o.notes = n ? n.notes : null; }
          return o;
        }),
      };
      if (detail) row.composite_detail = parse(comp.note);
      return row;
    });
    // CSV: one line per country and section
    const flat = [];
    for (const r of out) for (const s of r.sections) flat.push({ country: r.country, score_date: r.score_date, section: s.section, cost: s.cost, cost_trend: s.cost_trend, risk: s.risk, risk_trend: s.risk_trend, cost_pressure: r.cost_pressure, disruption_risk: r.disruption_risk });
    return send(res, req, flat, ['country', 'score_date', 'section', 'cost', 'cost_trend', 'risk', 'risk_trend', 'cost_pressure', 'disruption_risk'], 'scores.csv',
                () => ({ sector, count: out.length, countries: out }));
  } catch (e) {
    return fail(res, 502, e.message);
  }
}
