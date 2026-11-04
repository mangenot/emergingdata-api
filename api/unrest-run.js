// GET /api/unrest-run?key=<ED_RELAY_SECRET>[&from=2026-08][&to=2026-10][&country=KEN][&dry=1]
// A news-based proxy for unrest, from the GDELT DOC 2.0 API (free, no key): the number of articles with GDELT's
// PROTEST theme published by the country's own media each month, and the same per 100,000 articles monitored by
// GDELT that month (the normaliser). Written for each pilot country as
//   POL_UNREST        protest-themed articles in domestic media, per month
//   POL_UNREST_SHARE  the same per 100,000 monitored articles
// GDELT allows one request every five seconds and refuses long windows, so the route asks for one three-month window
// per country (default: the last three months) with a pause between countries; older months are loaded by calling
// the route with from and to (three months at a time). The current month is the month to date. Cron on the 2nd.
import { sb, fail, writeObservations } from './_lib.js';

const FIPS = { BGD: 'BG', PAK: 'PK', KEN: 'KE', KHM: 'CB', HND: 'HO' };   // GDELT uses FIPS country codes
const PAUSE_MS = 6000;

function allowed(req) {
  const secret = process.env.ED_RELAY_SECRET || '', cron = process.env.CRON_SECRET || '';
  const key = String(req.query.key || req.headers['x-relay-key'] || '');
  const auth = String(req.headers['authorization'] || '');
  return (secret && key === secret) || (cron && auth === `Bearer ${cron}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function addMonths(ym, n) { const y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n; return `${y + Math.floor(m / 12)}-${String((m % 12 + 12) % 12 + 1).padStart(2, '0')}`; }
function lastDay(ym) { const y = +ym.slice(0, 4), m = +ym.slice(5, 7); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

async function fetchCountry(fips, from, to) {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(`theme:PROTEST sourcecountry:${fips}`)}&mode=timelinevolraw` +
              `&startdatetime=${from.replace('-', '')}01000000&enddatetime=${to.replace('-', '')}${lastDay(to)}235959&format=json`;
  const r = await fetch(url, { headers: { 'User-Agent': 'EmergingData/1.0', Accept: 'application/json' } });
  const text = await r.text();
  if (!r.ok) throw new Error(`GDELT ${r.status}: ${text.slice(0, 100)}`);
  let j; try { j = JSON.parse(text); } catch { throw new Error('GDELT: not JSON: ' + text.slice(0, 100)); }
  const data = (j.timeline && j.timeline[0] && j.timeline[0].data) || [];
  const byMonth = {};
  for (const p of data) {
    const m = `${p.date.slice(0, 4)}-${p.date.slice(4, 6)}`;
    const b = byMonth[m] = byMonth[m] || { articles: 0, monitored: 0, days: 0 };
    b.articles += p.value || 0; b.monitored += p.norm || 0; b.days++;
  }
  return byMonth;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!allowed(req)) return fail(res, 401, 'needs key=ED_RELAY_SECRET or the cron secret');
  const today = new Date().toISOString().slice(0, 10), thisMonth = today.slice(0, 7);
  const dry = String(req.query.dry || '') === '1';
  const to = /^\d{4}-\d{2}$/.test(String(req.query.to || '')) ? String(req.query.to) : thisMonth;
  const from = /^\d{4}-\d{2}$/.test(String(req.query.from || '')) ? String(req.query.from) : addMonths(to, -2);
  const only = String(req.query.country || '').toUpperCase().split(',').map(s => s.trim()).filter(Boolean);
  try {
    let countries = (await sb('country?select=iso3&proposal=eq.Pilot&order=iso3')).map(c => c.iso3).filter(c => FIPS[c]);
    if (only.length) countries = countries.filter(c => only.includes(c));
    if (!countries.length) return fail(res, 400, 'no pilot country matches');
    const rows = [], errors = [], summary = {};
    for (let i = 0; i < countries.length; i++) {
      const iso = countries[i];
      if (i) await sleep(PAUSE_MS);
      try {
        const byMonth = await fetchCountry(FIPS[iso], from, to);
        summary[iso] = {};
        for (const [m, b] of Object.entries(byMonth)) {
          if (m < from || m > to) continue;
          const mtd = m === thisMonth ? '; month to date' : '';
          const share = b.monitored ? Math.round(b.articles / b.monitored * 1e5 * 100) / 100 : null;
          rows.push({ indicator_code: 'POL_UNREST', iso3: iso, obs_date: `${m}-01`, value: b.articles, note: `GDELT DOC 2.0, articles with the PROTEST theme from ${iso} media (sourcecountry ${FIPS[iso]}), ${b.days} days${mtd}` });
          if (share !== null) rows.push({ indicator_code: 'POL_UNREST_SHARE', iso3: iso, obs_date: `${m}-01`, value: share, note: `GDELT DOC 2.0, PROTEST-themed articles per 100,000 monitored articles${mtd}` });
          summary[iso][m] = { articles: b.articles, per_100k: share };
        }
      } catch (e) { errors.push(`${iso}: ${e.message}`); }
    }
    const result = rows.length ? await writeObservations(rows, today, dry) : { written: 0, unchanged: {}, rows: [] };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(errors.length && !rows.length ? 502 : 200).json({ run_date: today, dry, window: { from, to }, countries: summary, unchanged: result.unchanged, written: dry ? 0 : result.written, rows: dry ? result.rows.length : undefined, errors });
  } catch (e) {
    return fail(res, 502, e.message);
  }
}
