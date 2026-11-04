// Shared helpers for the EmergingData API routes (Vercel serverless functions, Node 18+).

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const API_KEYS = (process.env.ED_API_KEYS || '').split(',').map(s => s.trim()).filter(Boolean);

// Reads a PostgREST path such as "observation_latest?iso3=eq.BGD&select=..." with the server-side key.
export async function sb(path) {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Accept: 'application/json' },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

// Reads every row of a PostgREST path, page by page (Supabase caps a response at 1,000 rows by default).
export async function sbAll(path, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Accept: 'application/json', Range: `${from}-${from + pageSize - 1}` },
    });
    const text = await r.text();
    if (!r.ok && r.status !== 206) throw new Error(`Supabase ${r.status}: ${text.slice(0, 300)}`);
    const page = JSON.parse(text);
    out.push(...page);
    if (page.length < pageSize) return out;
  }
}

// Upserts rows into a table (merge on the unique constraint named by onConflict), with the server-side key.
export async function sbUpsert(table, rows, onConflict) {
  if (!rows.length) return 0;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error(`Supabase ${r.status} on ${table}: ${(await r.text()).slice(0, 300)}`);
  return rows.length;
}

// Key check: when ED_API_KEYS is set, the request must carry one of its keys as x-api-key header or api_key
// query parameter. When it is not set (development), every request is accepted.
export function authorized(req) {
  if (!API_KEYS.length) return true;
  const key = req.headers['x-api-key'] || req.query.api_key || '';
  return API_KEYS.includes(String(key));
}

export function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows, columns) {
  const head = columns.join(',');
  const body = rows.map(r => columns.map(c => csvEscape(r[c])).join(',')).join('\n');
  return head + '\n' + body + '\n';
}

export function send(res, req, rows, columns, filename, wrapper) {
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  const fmt = String(req.query.format || '').toLowerCase();
  if (fmt === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    return res.status(200).send(toCsv(rows, columns));
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(200).json(wrapper ? wrapper(rows) : rows);
}

export function fail(res, status, message) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(status).json({ error: message });
}

// "BGD,PAK" -> ["BGD","PAK"], upper case, letters digits and underscore only
export function codes(v) {
  return String(v || '').toUpperCase().split(',').map(s => s.trim()).filter(s => /^[A-Z0-9_]+$/.test(s));
}

export function isoDate(v, fallback) {
  const s = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s)) return s + '-01';
  if (/^\d{4}$/.test(s)) return s + '-01-01';
  return fallback;
}

// Minimal CSV parser (quoted fields, embedded commas and newlines); returns rows of strings.
export function parseCsv(text) {
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

// Writes observations with the vintage rule: a value equal to the latest vintage is skipped, a new or changed value
// gets a row dated today. rows: [{indicator_code, iso3, obs_date, value, note}]. Returns {written, unchanged, rows}.
export async function writeObservations(rows, today, dry) {
  const codes = [...new Set(rows.map(r => r.indicator_code))], isos = [...new Set(rows.map(r => r.iso3))];
  const existing = codes.length ? await sbAll(`observation_latest?select=indicator_code,iso3,obs_date,value&indicator_code=in.(${codes.join(',')})&iso3=in.(${isos.join(',')})`) : [];
  const have = new Map(existing.map(o => [`${o.indicator_code}|${o.iso3}|${o.obs_date}`, o.value === null ? null : Number(o.value)]));
  const out = [], unchanged = {};
  for (const r of rows) {
    const k = `${r.indicator_code}|${r.iso3}|${r.obs_date}`;
    if (have.has(k) && have.get(k) !== null && Math.abs(have.get(k) - r.value) < 1e-9) { unchanged[r.indicator_code] = (unchanged[r.indicator_code] || 0) + 1; continue; }
    out.push({ ...r, vintage_date: today });
  }
  let written = 0;
  if (!dry && out.length) written = await sbUpsert('observation', out, 'indicator_code,iso3,obs_date,vintage_date');
  return { written, unchanged, rows: out };
}
