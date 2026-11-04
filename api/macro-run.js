// GET /api/macro-run?key=<ED_RELAY_SECRET>[&country=KEN,BGD][&dry=1]
// Loads the annual public-finance and external-debt indicators of the pilot countries from two open APIs and writes
// them to the observation table (one row per indicator, country and year; a changed value adds a new vintage, an
// unchanged one is left alone):
//   IMF World Economic Outlook (SDMX 3.0, dataflow IMF.RES/WEO): general government gross debt and net lending in
//     % of GDP, current account in % of GDP, GDP in USD. Years from the current year on are IMF projections and are
//     flagged as such in the note. Fiscal-year countries (Bangladesh, Kenya, Pakistan) report the year ending in June.
//   World Bank API v2 (International Debt Statistics and WDI): external debt stocks in % of GNI, total debt service
//     in % of exports, central government interest payments in % of revenue.
// Also run by the Vercel cron on the 3rd of each month (vercel.json), which sends Authorization: Bearer CRON_SECRET.
import { sb, sbAll, sbUpsert, fail } from './_lib.js';

const FROM_YEAR = 2015;
const WEO = { GGXWDG_NGDP: 'EXT_GDEBT', GGXCNL_NGDP: 'EXT_FISC', BCA_NGDPD: 'EXT_CA', NGDPD: 'EXT_GDP' };
const WB = {
  'DT.DOD.DECT.GN.ZS': { code: 'EXT_DEBT', note: 'World Bank International Debt Statistics, external debt stocks in % of GNI' },
  'DT.TDS.DECT.EX.ZS': { code: 'EXT_DS', note: 'World Bank International Debt Statistics, total debt service in % of exports of goods, services and primary income' },
  'GC.XPN.INTP.RV.ZS': { code: 'EXT_INT', note: 'World Bank WDI (IMF GFS), central government interest payments in % of revenue' },
};

function allowed(req) {
  const secret = process.env.ED_RELAY_SECRET || '', cron = process.env.CRON_SECRET || '';
  const key = String(req.query.key || req.headers['x-relay-key'] || '');
  const auth = String(req.headers['authorization'] || '');
  if (secret && key === secret) return true;
  if (cron && auth === `Bearer ${cron}`) return true;
  return false;
}

// Minimal CSV parser (quoted fields, embedded commas and newlines).
function parseCsv(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r.length === 1 && r[0] !== ''));
}

async function fetchWeo(isos, thisYear) {
  const url = `https://api.imf.org/external/sdmx/3.0/data/dataflow/IMF.RES/WEO/~/${isos.join('+')}.${Object.keys(WEO).join('+')}.A`;
  const r = await fetch(url, { headers: { Accept: 'application/vnd.sdmx.data+csv;version=2.0.0, text/csv' } });
  if (!r.ok) throw new Error(`IMF WEO ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const rows = parseCsv(await r.text());
  const h = rows[0], ix = n => h.indexOf(n);
  const iC = ix('COUNTRY'), iI = ix('INDICATOR'), iT = ix('TIME_PERIOD'), iV = ix('OBS_VALUE'), iU = ix('COUNTRY_UPDATE_DATE');
  if (iC < 0 || iI < 0 || iT < 0 || iV < 0) throw new Error('IMF WEO: unexpected columns ' + h.slice(0, 8).join(','));
  const out = [];
  for (const c of rows.slice(1)) {
    const year = +c[iT], v = parseFloat(c[iV]), code = WEO[c[iI]];
    if (!code || !isos.includes(c[iC]) || !(year >= FROM_YEAR && year <= thisYear + 2) || !isFinite(v)) continue;
    const value = c[iI] === 'NGDPD' ? v / 1e9 : v;      // USD to USD billion
    const upd = iU >= 0 && c[iU] ? `, country update ${c[iU]}` : '';
    out.push({ indicator_code: code, iso3: c[iC], obs_date: `${year}-01-01`, value: Math.round(value * 1000) / 1000,
               note: `IMF WEO${upd}${year >= thisYear ? '; IMF projection' : ''}` });
  }
  return out;
}

async function fetchWorldBank(isos, thisYear) {
  const out = [];
  for (const [wb, spec] of Object.entries(WB)) {
    const url = `https://api.worldbank.org/v2/country/${isos.join(';')}/indicator/${wb}?format=json&per_page=1000&date=${FROM_YEAR}:${thisYear}`;
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`World Bank ${wb} ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    for (const row of (Array.isArray(j) && Array.isArray(j[1]) ? j[1] : [])) {
      if (row.value == null || !isos.includes(row.countryiso3code)) continue;
      out.push({ indicator_code: spec.code, iso3: row.countryiso3code, obs_date: `${row.date}-01-01`, value: Math.round(row.value * 1000) / 1000, note: spec.note });
    }
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!allowed(req)) return fail(res, 401, 'needs key=ED_RELAY_SECRET or the cron secret');
  const today = new Date().toISOString().slice(0, 10), thisYear = +today.slice(0, 4);
  const dry = String(req.query.dry || '') === '1';
  const only = String(req.query.country || '').toUpperCase().split(',').map(s => s.trim()).filter(Boolean);
  try {
    let countries = (await sb('country?select=iso3&proposal=eq.Pilot&order=iso3')).map(c => c.iso3).filter(c => c !== 'WLD');
    if (only.length) countries = countries.filter(c => only.includes(c));
    if (!countries.length) return fail(res, 400, 'no pilot country matches');
    const errors = [];
    const fetched = [];
    for (const [name, fn] of [['IMF WEO', fetchWeo], ['World Bank', fetchWorldBank]]) {
      try { fetched.push(...await fn(countries, thisYear)); } catch (e) { errors.push(`${name}: ${e.message}`); }
    }
    const codes = [...new Set(fetched.map(r => r.indicator_code))];
    // compare with the latest vintage: only new or changed values get a row
    const existing = codes.length ? await sbAll(`observation_latest?select=indicator_code,iso3,obs_date,value&indicator_code=in.(${codes.join(',')})&iso3=in.(${countries.join(',')})`) : [];
    const have = new Map(existing.map(o => [`${o.indicator_code}|${o.iso3}|${o.obs_date}`, o.value === null ? null : Number(o.value)]));
    const rows = [], unchanged = {};
    for (const r of fetched) {
      const k = `${r.indicator_code}|${r.iso3}|${r.obs_date}`;
      if (have.has(k) && have.get(k) !== null && Math.abs(have.get(k) - r.value) < 1e-9) { unchanged[r.indicator_code] = (unchanged[r.indicator_code] || 0) + 1; continue; }
      rows.push({ ...r, vintage_date: today });
    }
    let written = 0;
    if (!dry && rows.length) written = await sbUpsert('observation', rows, 'indicator_code,iso3,obs_date,vintage_date');
    const perCode = {};
    for (const r of rows) { const p = perCode[r.indicator_code] = perCode[r.indicator_code] || { new_or_revised: 0, latest: {} }; p.new_or_revised++; if (!p.latest[r.iso3] || r.obs_date > p.latest[r.iso3].date) p.latest[r.iso3] = { date: r.obs_date.slice(0, 4), value: r.value }; }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(errors.length && !fetched.length ? 502 : 200).json({
      run_date: today, dry, countries, fetched: fetched.length, unchanged, written: dry ? 0 : written, rows: dry ? rows.length : undefined,
      indicators: perCode, errors,
    });
  } catch (e) {
    return fail(res, 502, e.message);
  }
}
