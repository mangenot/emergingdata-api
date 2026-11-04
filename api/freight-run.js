// GET /api/freight-run?key=<ED_RELAY_SECRET>[&dry=1]
// Reads the weekly Drewry World Container Index from Drewry's public page (the "detailed assessment" paragraph that
// Drewry publishes every Thursday and that the trade press republishes) and writes, for country WLD and the date of
// the assessment:
//   GLB_FRT         WCI composite, USD per 40ft container
//   GLB_FRT_SH_RT   Shanghai to Rotterdam      GLB_FRT_SH_GE   Shanghai to Genoa
//   GLB_FRT_SH_LA   Shanghai to Los Angeles    GLB_FRT_SH_NY   Shanghai to New York
// The page carries only the latest week, so the history builds up from the first run. If Drewry changes the wording
// the parse fails and the result says so (errors), with nothing written. Also run by the Vercel cron on Fridays.
import { fail, writeObservations } from './_lib.js';

const PAGE = 'https://www.drewry.co.uk/supply-chain-advisors/supply-chain-expertise/world-container-index-assessed-by-drewry';
const MON = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
const LANES = [
  ['GLB_FRT_SH_RT', 'Shanghai to Rotterdam'], ['GLB_FRT_SH_GE', 'Shanghai to Genoa'],
  ['GLB_FRT_SH_LA', 'Shanghai to Los Angeles'], ['GLB_FRT_SH_NY', 'Shanghai to New York'],
];

function allowed(req) {
  const secret = process.env.ED_RELAY_SECRET || '', cron = process.env.CRON_SECRET || '';
  const key = String(req.query.key || req.headers['x-relay-key'] || '');
  const auth = String(req.headers['authorization'] || '');
  return (secret && key === secret) || (cron && auth === `Bearer ${cron}`);
}

// Parses the assessment text; exported for tests.
export function parseWci(html) {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  const start = text.search(/Our detailed assessment for/i);
  if (start < 0) throw new Error('assessment paragraph not found');
  const t = text.slice(start, start + 4000);
  const dm = /assessment for (?:\w+day,? )?(\d{1,2}) (\w{3})\w* (\d{4})/i.exec(t);
  if (!dm || !MON[dm[2].slice(0, 3)]) throw new Error('assessment date not found: ' + t.slice(0, 80));
  const date = `${dm[3]}-${MON[dm[2].slice(0, 3)]}-${dm[1].padStart(2, '0')}`;
  const money = s => parseInt(s.replace(/,/g, ''), 10);
  const cm = /\(WCI\)[^$]{0,300}?\$([\d,]+) per 40ft/i.exec(t);
  if (!cm) throw new Error('composite not found');
  const out = { date, composite: money(cm[1]), lanes: {} };
  for (const [code, name] of LANES) {
    const re = new RegExp(name.replace(/ /g, '\\s+') + '[^$]{0,120}?\\$([\\d,]+)', 'i');
    const m = re.exec(t);
    if (m) out.lanes[code] = money(m[1]);
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!allowed(req)) return fail(res, 401, 'needs key=ED_RELAY_SECRET or the cron secret');
  const today = new Date().toISOString().slice(0, 10);
  const dry = String(req.query.dry || '') === '1';
  try {
    const r = await fetch(PAGE, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EmergingData/1.0)', Accept: 'text/html' } });
    if (!r.ok) return fail(res, 502, `Drewry page HTTP ${r.status}`);
    const parsed = parseWci(await r.text());
    const note = `Drewry World Container Index, USD per 40ft container, assessment of ${parsed.date} (drewry.co.uk)`;
    const rows = [{ indicator_code: 'GLB_FRT', iso3: 'WLD', obs_date: parsed.date, value: parsed.composite, note }];
    for (const [code, v] of Object.entries(parsed.lanes)) rows.push({ indicator_code: code, iso3: 'WLD', obs_date: parsed.date, value: v, note });
    const result = await writeObservations(rows, today, dry);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ run_date: today, dry, assessment: parsed.date, composite: parsed.composite, lanes: parsed.lanes,
                                  unchanged: result.unchanged, written: dry ? 0 : result.written, rows: dry ? result.rows.length : undefined, errors: [] });
  } catch (e) {
    return fail(res, 502, e.message);
  }
}
