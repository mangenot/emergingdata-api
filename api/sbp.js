// GET /api/sbp?series=TS_GP_BOP_WR_M.WR0010&from=2018-01-01[&to=YYYY-MM-DD]
// Relay to the State Bank of Pakistan EasyData API, for the Pakistan sheet: Cloudflare in front of EasyData blocks
// Google Apps Script's servers, so the sheet asks this route, which fetches from Vercel's side with the SBP key kept
// in the environment (SBP_API_KEY). Protected by a shared secret (ED_RELAY_SECRET) sent as the x-relay-key header,
// separate from the public ED_API_KEYS. Answers with EasyData's own JSON ({columns, rows}) plus "fetched".
import { fail, isoDate } from './_lib.js';

const EASYDATA = 'https://easydata.sbp.org.pk/api/v1/series/';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return fail(res, 405, 'GET only');

  const secret = process.env.ED_RELAY_SECRET || '';
  if (!secret) return fail(res, 503, 'ED_RELAY_SECRET is not set on the server');
  if (String(req.headers['x-relay-key'] || req.query.relay_key || '') !== secret) return fail(res, 401, 'Bad or missing relay key');

  const sbpKey = process.env.SBP_API_KEY || '';
  if (!sbpKey) return fail(res, 503, 'SBP_API_KEY is not set on the server');

  const series = String(req.query.series || '').trim();
  if (!/^[A-Z0-9_]+\.[A-Z0-9_]+$/i.test(series)) return fail(res, 400, 'series must look like TS_GP_BOP_WR_M.WR0010');
  const from = isoDate(req.query.from, '2018-01-01');
  const to = isoDate(req.query.to, new Date().toISOString().slice(0, 10));

  const url = `${EASYDATA}${encodeURIComponent(series)}/data?api_key=${encodeURIComponent(sbpKey)}&format=json&start_date=${from}&end_date=${to}`;
  let upstream;
  try {
    upstream = await fetch(url, {
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 EmergingData/1.0',
      },
      signal: AbortSignal.timeout(25000),
    });
  } catch (e) {
    return fail(res, 502, `EasyData unreachable: ${String(e.message || e).slice(0, 200)}`);
  }
  const text = await upstream.text();
  if (!upstream.ok) {
    const plain = text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return fail(res, 502, `EasyData ${upstream.status} for ${series}: ${plain.slice(0, 300)}`);
  }
  let body;
  try { body = JSON.parse(text); }
  catch { return fail(res, 502, `EasyData answered something that is not JSON for ${series}: ${text.slice(0, 200)}`); }

  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(200).json({ series, from, to, fetched: new Date().toISOString(), ...body });
}
