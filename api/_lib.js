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
