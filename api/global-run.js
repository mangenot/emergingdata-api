// GET /api/global-run?key=<ED_RELAY_SECRET>[&dry=1]
// Loads the global drivers of the country reports (country WLD) from EmergingTextiles' own workbooks through the ET
// Sheets API (api.emergingtextiles.com, key in ET_API_KEY):
//   GLB_BRENT        Brent crude, monthly average, USD per barrel (EmergingTextiles_Monthly, Polyester-Chain.csv, column B;
//                    the current month is the month to date and is revised at the next run)
//   GLB_US_APP_USD   US apparel imports, USD million (US-Apparel-Imports-Monthly, Source, column C)
//   GLB_US_APP       the same, % change on a year earlier
//   GLB_EU_APP_EUR   EU-27 clothing imports, EUR million (EU-Clothing-Imports-MONTHLY, Source, column C)
//   GLB_EU_APP_USD   the same in USD million (column D)
//   GLB_EU_APP       EUR value, % change on a year earlier
// A changed value adds a new vintage, an unchanged one is left alone. Also run by the Vercel cron on the 3rd.
import { sb, fail, parseCsv, writeObservations } from './_lib.js';

const ET_BASE = (process.env.ET_API_BASE || 'https://api.emergingtextiles.com').replace(/\/$/, '');
const FROM = '2015-01-01';
const MON = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
const SOURCES = [
  { sheet: 'EmergingTextiles_Monthly', tab: 'Polyester-Chain.csv', series: [{ col: 1, code: 'GLB_BRENT', scale: 1, note: 'EmergingTextiles, monthly average of the Brent spot price' }] },
  { sheet: 'US-Apparel-Imports-Monthly', tab: 'Source', series: [{ col: 2, code: 'GLB_US_APP_USD', scale: 1e-6, note: 'OTEXA via EmergingTextiles, US apparel imports, category 1, customs value', yoy: 'GLB_US_APP' }] },
  { sheet: 'EU-Clothing-Imports-MONTHLY', tab: 'Source', series: [{ col: 2, code: 'GLB_EU_APP_EUR', scale: 1e-6, note: 'Eurostat via EmergingTextiles, EU-27 clothing imports (HS 61 and 62), extra-EU', yoy: 'GLB_EU_APP' },
                                                                    { col: 3, code: 'GLB_EU_APP_USD', scale: 1e-6, note: 'Eurostat via EmergingTextiles, EU-27 clothing imports converted at the monthly EUR/USD rate' }] },
];

function allowed(req) {
  const secret = process.env.ED_RELAY_SECRET || '', cron = process.env.CRON_SECRET || '';
  const key = String(req.query.key || req.headers['x-relay-key'] || '');
  const auth = String(req.headers['authorization'] || '');
  return (secret && key === secret) || (cron && auth === `Bearer ${cron}`);
}

// "Jan 26", " Nov 07" -> 2026-01-01; anything else -> null
function monthOf(label) {
  const m = /^\s*([A-Z][a-z]{2})\s+(\d{2})\s*$/.exec(String(label || ''));
  if (!m || !MON[m[1]]) return null;
  return `20${m[2]}-${MON[m[1]]}-01`;
}
function num(s) { const v = parseFloat(String(s || '').replace(/,/g, '')); return isFinite(v) ? v : null; }

async function fetchTab(sheet, tab) {
  const key = process.env.ET_API_KEY || '';
  if (!key) throw new Error('ET_API_KEY is not set');
  const url = `${ET_BASE}/api/csv/${encodeURIComponent(sheet)}/${encodeURIComponent(tab)}?api_key=${encodeURIComponent(key)}`;
  const r = await fetch(url, { headers: { Accept: 'text/csv' } });
  if (!r.ok) throw new Error(`${sheet}/${tab}: HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
  return parseCsv(await r.text());
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!allowed(req)) return fail(res, 401, 'needs key=ED_RELAY_SECRET or the cron secret');
  const today = new Date().toISOString().slice(0, 10), thisMonth = today.slice(0, 7) + '-01';
  const dry = String(req.query.dry || '') === '1';
  try {
    await sb('country?select=iso3&iso3=eq.WLD');     // fails early if the database is unreachable
    const rows = [], errors = [], seen = {};
    for (const src of SOURCES) {
      let grid;
      try { grid = await fetchTab(src.sheet, src.tab); } catch (e) { errors.push(e.message); continue; }
      for (const s of src.series) {
        const byMonth = new Map();
        for (const r of grid) {
          const d = monthOf(r[0]); if (!d || d < FROM) continue;
          const v = num(r[s.col]); if (v === null) continue;
          byMonth.set(d, v * s.scale);
        }
        for (const [d, v] of byMonth) {
          rows.push({ indicator_code: s.code, iso3: 'WLD', obs_date: d, value: Math.round(v * 1000) / 1000,
                      note: s.note + (d === thisMonth ? '; month to date' : '') });
          if (s.yoy) {
            const prev = byMonth.get(`${+d.slice(0, 4) - 1}${d.slice(4)}`);
            if (prev) rows.push({ indicator_code: s.yoy, iso3: 'WLD', obs_date: d, value: Math.round((v / prev - 1) * 1000) / 10, note: 'computed from ' + s.code + ', % change on the same month a year earlier' });
          }
        }
        seen[s.code] = byMonth.size; if (s.yoy) seen[s.yoy] = rows.filter(r => r.indicator_code === s.yoy).length;
      }
    }
    const result = rows.length ? await writeObservations(rows, today, dry) : { written: 0, unchanged: {}, rows: [] };
    const latest = {};
    for (const r of rows) if (!latest[r.indicator_code] || r.obs_date > latest[r.indicator_code].date) latest[r.indicator_code] = { date: r.obs_date.slice(0, 7), value: r.value };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(errors.length && !rows.length ? 502 : 200).json({
      run_date: today, dry, fetched: rows.length, series: seen, latest, unchanged: result.unchanged,
      written: dry ? 0 : result.written, rows: dry ? result.rows.length : undefined, errors,
    });
  } catch (e) {
    return fail(res, 502, e.message);
  }
}
