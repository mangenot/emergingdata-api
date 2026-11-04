// GET /api/unrest-run?key=<ED_RELAY_SECRET>[&from=2025-08][&to=2026-11][&country=KEN][&dry=1]
// The unrest proxy, from the GDELT 2.0 event database as published on Google BigQuery (public dataset
// gdelt-bq.gdeltv2.events_partitioned, refreshed every 15 minutes). For each pilot country and month:
//   POL_UNREST        protest events (CAMEO root code 14) located in the country, counted by event date
//   POL_UNREST_SHARE  the same per 1,000 events of any kind located in the country (controls for coverage)
// An event is counted only when GDELT added it within 31 days of its date, which leaves out retrospective mentions
// (anniversaries, background paragraphs). A month is therefore provisional until 31 days after its end, and the
// current month is the month to date; the default window is the last three months, so the cron on the 2nd finalises
// the month before last, refreshes the last month and starts the current one. One query covers any window.
// Needs GCP_SA_KEY: the JSON key of a Google service account with the BigQuery Job User role on its project; the
// query runs in that project (about 0.2 GB per month of window, inside BigQuery's free tier).
import crypto from 'node:crypto';
import { sb, fail, writeObservations } from './_lib.js';

const FIPS = { BGD: 'BG', PAK: 'PK', KEN: 'KE', KHM: 'CB', HND: 'HO' };   // GDELT locates events with FIPS country codes
const ISO = Object.fromEntries(Object.entries(FIPS).map(([iso, f]) => [f, iso]));
const TABLE = 'gdelt-bq.gdeltv2.events_partitioned';
const LAG_DAYS = 31;

function allowed(req) {
  const secret = process.env.ED_RELAY_SECRET || '', cron = process.env.CRON_SECRET || '';
  const key = String(req.query.key || req.headers['x-relay-key'] || '');
  const auth = String(req.headers['authorization'] || '');
  return (secret && key === secret) || (cron && auth === `Bearer ${cron}`);
}
function addMonths(ym, n) { const y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n; return `${y + Math.floor(m / 12)}-${String((m % 12 + 12) % 12 + 1).padStart(2, '0')}`; }
function addDays(d, n) { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
const firstDay = ym => `${ym}-01`;
const dayAfterMonth = ym => firstDay(addMonths(ym, 1));

function credentials() {
  const raw = process.env.GCP_SA_KEY || '';
  if (!raw) throw new Error('GCP_SA_KEY is not set (the JSON key of a Google service account with the BigQuery Job User role)');
  let k; try { k = JSON.parse(raw); } catch { throw new Error('GCP_SA_KEY is not valid JSON: paste the whole key file'); }
  if (!k.client_email || !k.private_key || !k.project_id) throw new Error('GCP_SA_KEY lacks client_email, private_key or project_id');
  return k;
}

// Service-account JWT exchanged for an access token (no library needed).
async function accessToken(k) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: k.client_email, scope: 'https://www.googleapis.com/auth/bigquery.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(k.private_key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${unsigned}.${signature}`,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Google token ${r.status}: ${(j.error_description || j.error || '').toString().slice(0, 200)}`);
  return j.access_token;
}

const str = (name, value) => ({ name, parameterType: { type: 'STRING' }, parameterValue: { value } });
const int = (name, value) => ({ name, parameterType: { type: 'INT64' }, parameterValue: { value: String(value) } });
const strs = (name, values) => ({ name, parameterType: { type: 'ARRAY', arrayType: { type: 'STRING' } }, parameterValue: { arrayValues: values.map(v => ({ value: v })) } });

async function runQuery(k, token, query, queryParameters) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  let r = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${k.project_id}/queries`, {
    method: 'POST', headers, body: JSON.stringify({ query, useLegacySql: false, parameterMode: 'NAMED', queryParameters, timeoutMs: 120000, maxResults: 5000 }),
  });
  let j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`BigQuery ${r.status}: ${((j.error && j.error.message) || '').slice(0, 300)}`);
  for (let i = 0; i < 10 && !j.jobComplete; i++) {
    const { jobId, location } = j.jobReference || {};
    r = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${k.project_id}/queries/${jobId}?location=${encodeURIComponent(location || 'US')}&timeoutMs=30000&maxResults=5000`, { headers });
    j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`BigQuery ${r.status}: ${((j.error && j.error.message) || '').slice(0, 300)}`);
  }
  if (!j.jobComplete) throw new Error('BigQuery: the query did not finish in time');
  const names = (j.schema && j.schema.fields || []).map(f => f.name);
  return { rows: (j.rows || []).map(row => Object.fromEntries(row.f.map((c, i) => [names[i], c.v]))), bytes: Number(j.totalBytesProcessed || 0) };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!allowed(req)) return fail(res, 401, 'needs key=ED_RELAY_SECRET or the cron secret');
  const today = new Date().toISOString().slice(0, 10), thisMonth = today.slice(0, 7);
  const dry = String(req.query.dry || '') === '1';
  const to = /^\d{4}-\d{2}$/.test(String(req.query.to || '')) ? String(req.query.to) : thisMonth;
  const from = /^\d{4}-\d{2}$/.test(String(req.query.from || '')) ? String(req.query.from) : addMonths(to, -2);
  if (from > to) return fail(res, 400, 'from is after to');
  const only = String(req.query.country || '').toUpperCase().split(',').map(s => s.trim()).filter(Boolean);
  try {
    const k = credentials();
    let countries = (await sb('country?select=iso3&proposal=eq.Pilot&order=iso3')).map(c => c.iso3).filter(c => FIPS[c]);
    if (only.length) countries = countries.filter(c => only.includes(c));
    if (!countries.length) return fail(res, 400, 'no pilot country matches');
    const token = await accessToken(k);
    // partitions are by the day GDELT added the event: the window plus the lag, but not beyond tomorrow
    const pFrom = firstDay(from), pToWanted = addDays(dayAfterMonth(to), LAG_DAYS), pTo = pToWanted < addDays(today, 1) ? pToWanted : addDays(today, 1);
    const query = `SELECT ActionGeo_CountryCode AS cc, MonthYear AS ym, COUNTIF(EventRootCode = '14') AS protests, COUNT(*) AS events
FROM \`${TABLE}\`
WHERE _PARTITIONTIME >= TIMESTAMP(@p_from) AND _PARTITIONTIME < TIMESTAMP(@p_to)
  AND ActionGeo_CountryCode IN UNNEST(@codes)
  AND MonthYear BETWEEN @ym_from AND @ym_to
  AND DATE_DIFF(DATE(_PARTITIONTIME), SAFE.PARSE_DATE('%Y%m%d', CAST(SQLDATE AS STRING)), DAY) BETWEEN 0 AND @lag
GROUP BY cc, ym ORDER BY cc, ym`;
    const { rows: found, bytes } = await runQuery(k, token, query, [
      str('p_from', pFrom), str('p_to', pTo), strs('codes', countries.map(c => FIPS[c])),
      int('ym_from', from.replace('-', '')), int('ym_to', to.replace('-', '')), int('lag', LAG_DAYS),
    ]);
    const rows = [], summary = {};
    for (const f of found) {
      const iso = ISO[f.cc], m = `${String(f.ym).slice(0, 4)}-${String(f.ym).slice(4, 6)}`;
      if (!iso || m < from || m > to) continue;
      const protests = Number(f.protests), events = Number(f.events);
      const status = m === thisMonth ? '; month to date' : addDays(dayAfterMonth(m), LAG_DAYS) > today ? '; provisional until 31 days after the month' : '';
      const share = events ? Math.round(protests / events * 1000 * 10) / 10 : null;
      rows.push({ indicator_code: 'POL_UNREST', iso3: iso, obs_date: `${m}-01`, value: protests, note: `GDELT 2.0 events on BigQuery, CAMEO root code 14 located in ${iso} (${FIPS[iso]}), events added within ${LAG_DAYS} days of their date${status}` });
      if (share !== null) rows.push({ indicator_code: 'POL_UNREST_SHARE', iso3: iso, obs_date: `${m}-01`, value: share, note: `GDELT 2.0 events on BigQuery, protest events per 1,000 events located in ${iso}${status}` });
      (summary[iso] = summary[iso] || {})[m] = { protests, per_1000: share };
    }
    const result = rows.length ? await writeObservations(rows, today, dry) : { written: 0, unchanged: {}, rows: [] };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      run_date: today, dry, window: { from, to }, bigquery_mb_scanned: Math.round(bytes / 1e6), project: k.project_id,
      countries: summary, unchanged: result.unchanged, written: dry ? 0 : result.written, rows: dry ? result.rows.length : undefined, errors: [],
    });
  } catch (e) {
    return fail(res, 502, e.message);
  }
}
