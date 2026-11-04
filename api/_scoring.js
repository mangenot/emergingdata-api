// EmergingData scoring engine, version 1.2 (4 November 2026): unrest proxy from GDELT in the politics risk; 1.1: targeted sanctions give 3 not 4, a graduation date is a review.
// Pure functions: the registry rulebook (scoring_rule table) applied to the observations and events of one country,
// giving the nine section scores (cost and risk, 1 to 5, with a trend arrow each) and the two apparel composites.
// Every score carries the inputs it used and the rules it could not apply, so the result explains itself.
//
// Conventions: a score of 1 is the best reading for the buyer (lowest cost, lowest risk), 5 the worst.
// Trend "up" means the score is worsening (cost rising, risk rising), "down" improving, "stable" otherwise.
// Dates are ISO strings; observations come from observation_latest; events from the event table.

const SECTIONS = ['POL', 'TRD', 'EXT', 'FX', 'INF', 'FIN', 'LAB', 'INV', 'ENV'];

// ---- Rating scale (used as a spread proxy and for the CCC floor) ----------------------------------------------------
const RATING_SCALE = {
  'AAA': 1, 'AA+': 2, 'AA': 3, 'AA-': 4, 'A+': 5, 'A': 6, 'A-': 7, 'BBB+': 8, 'BBB': 9, 'BBB-': 10,
  'BB+': 11, 'BB': 12, 'BB-': 13, 'B+': 14, 'B': 15, 'B-': 16, 'CCC+': 17, 'CCC': 18, 'CCC-': 19, 'CC': 20, 'C': 21, 'D': 22,
  'AAA ': 1, 'AA1': 2, 'AA2': 3, 'AA3': 4, 'A1': 5, 'A2': 6, 'A3': 7, 'BAA1': 8, 'BAA2': 9, 'BAA3': 10,
  'BA1': 11, 'BA2': 12, 'BA3': 13, 'B1': 14, 'B2': 15, 'B3': 16, 'CAA1': 17, 'CAA2': 18, 'CAA3': 19, 'CA': 20,
};

// Median rating grade found in a rating text such as "Fitch B- stable; S&P B stable; Moody's B3 stable".
export function ratingGrade(text) {
  if (!text) return null;
  const grades = [];
  for (const m of String(text).matchAll(/\b(AAA|AA[+-]?|A[+-]?|BBB[+-]?|BB[+-]?|B[+-]?|CCC[+-]?|CC|C|D|Aaa|Aa[123]|A[123]|Baa[123]|Ba[123]|B[123]|Caa[123]|Ca)\b/g)) {
    const g = RATING_SCALE[m[1].toUpperCase()];
    if (g) grades.push(g);
  }
  if (!grades.length) return null;
  grades.sort((a, b) => a - b);
  return grades[Math.floor((grades.length - 1) / 2)];
}

// ---- Small helpers --------------------------------------------------------------------------------------------------
const ym = d => String(d).slice(0, 7);
function addMonths(iso, n) {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7) - 1 + n;
  const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, '0')}-01`;
}
function monthsBetween(a, b) { return (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7)); }
const round = (x, d = 2) => x === null || x === undefined || !isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d;
const clamp = s => s === null ? null : Math.max(1, Math.min(5, Math.round(s)));
function bucket(x, cuts, scores) {          // cuts ascending: x < cuts[0] -> scores[0], ... x >= cuts[last] -> scores[last]
  if (x === null || x === undefined || !isFinite(x)) return null;
  for (let i = 0; i < cuts.length; i++) if (x < cuts[i]) return scores[i];
  return scores[cuts.length];
}

// A series: the numeric observations of one indicator, sorted by date, as [{date, value, text, note}].
class Series {
  constructor(rows) { this.rows = (rows || []).filter(r => r.date).sort((a, b) => a.date < b.date ? -1 : 1); }
  get length() { return this.rows.length; }
  latest(asOf) { for (let i = this.rows.length - 1; i >= 0; i--) if (this.rows[i].date <= asOf) return this.rows[i]; return null; }
  at(month) { const r = this.rows.find(x => ym(x.date) === ym(month)); return r || null; }   // exact month
  valueAt(month) { const r = this.at(month); return r && r.value !== null ? r.value : null; }
  // value in force at a date for step series (tariffs, wages, ratings): the last observation on or before the date
  inForce(asOf) { const r = this.latest(asOf); return r ? r : null; }
  // mean of the values of the n months ending at month (inclusive); null if fewer than half present
  meanWindow(endMonth, n) {
    const vals = [];
    for (let k = 0; k < n; k++) { const v = this.valueAt(addMonths(endMonth, -k)); if (v !== null) vals.push(v); }
    return vals.length >= Math.ceil(n / 2) ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
  lastMonth(asOf) { const r = this.latest(asOf); return r ? ym(r.date) + '-01' : null; }
}

export function indexObservations(obs) {
  const by = {};
  for (const o of obs) {
    (by[o.indicator_code] = by[o.indicator_code] || []).push({ date: o.obs_date, value: o.value === null || o.value === undefined ? null : Number(o.value), text: o.text_value || null, note: o.note || null });
  }
  const out = {};
  for (const k in by) out[k] = new Series(by[k]);
  return out;
}

// ---- Derived indicators ---------------------------------------------------------------------------------------------
// Each returns {value, date, how} or null. 'asOf' is the scoring month (first day).
export function derived(S, asOf, country) {
  const d = {};
  const fx = S.FX_USD, cpi = S.INF_CPI, res = S.EXT_RES, imp = S.TRD_IMP, pol = S.FIN_POLICY;
  const dollarised = /dollari/i.test(country.fx_regime || '');

  // Months of import cover: reserves over the average monthly imports of the last 12 months available.
  if (res && imp) {
    const r = res.latest(asOf);
    if (r) {
      const m = imp.meanWindow(imp.lastMonth(asOf) || asOf, 12);
      if (m) d.EXT_RES_MOI = { value: round(r.value / m, 1), date: r.date, how: `reserves ${round(r.value, 0)} USD m at ${ym(r.date)} over average monthly imports ${round(m, 0)} (12 months to ${ym(imp.lastMonth(asOf))})` };
    }
  }
  // 12-month change of the exchange rate, % (negative = depreciation of the local currency), and volatility.
  if (fx) {
    const last = fx.latest(asOf);
    if (last) {
      const prev = fx.valueAt(addMonths(ym(last.date) + '-01', -12));
      if (prev) d.FX_12M = { value: round((prev / last.value - 1) * 100, 1), date: last.date, how: `${country.currency} per USD ${round(last.value, 2)} at ${ym(last.date)} vs ${round(prev, 2)} a year earlier` };
      const changes = [];
      for (let k = 0; k < 12; k++) {
        const a = fx.valueAt(addMonths(ym(last.date) + '-01', -k)), b = fx.valueAt(addMonths(ym(last.date) + '-01', -k - 1));
        if (a && b) changes.push(Math.log(a / b));
      }
      if (changes.length >= 6) {
        const mean = changes.reduce((x, y) => x + y, 0) / changes.length;
        const sd = Math.sqrt(changes.reduce((x, y) => x + (y - mean) ** 2, 0) / changes.length);
        d.FX_VOL = { value: round(sd * Math.sqrt(12) * 100, 1), date: last.date, how: `annualised standard deviation of monthly changes over ${changes.length} months` };
      }
    }
  }
  if (dollarised) { d.FX_12M = d.FX_12M || { value: 0, date: asOf, how: 'dollarised economy' }; d.FX_VOL = { value: 0, date: asOf, how: 'dollarised economy: no currency risk on USD contracts, flagged' }; }
  // Real policy rate.
  if (pol && cpi) {
    const p = pol.latest(asOf), c = cpi.latest(asOf);
    if (p && c) d.FIN_REAL = { value: round(p.value - c.value, 1), date: p.date, how: `policy rate ${p.value}% (${ym(p.date)}) minus inflation ${c.value}% (${ym(c.date)})` };
  }
  // Wages in USD.
  for (const [code, out] of [['LAB_SECW', 'LAB_SECW_USD'], ['LAB_MINW', 'LAB_MINW_USD']]) {
    const w = S[code] && S[code].inForce(asOf);
    if (!w || w.value === null) continue;
    if (dollarised) { d[out] = { value: round(w.value, 2), date: w.date, how: 'wage set in USD' }; continue; }
    const r = fx && fx.latest(asOf);
    if (r) {
      const usd = w.value / r.value;
      const r12 = fx.valueAt(addMonths(ym(r.date) + '-01', -12)), w12 = S[code].inForce(addMonths(asOf, -12));
      const usd12 = r12 && w12 && w12.value !== null ? w12.value / r12 : null;
      d[out] = { value: round(usd, 2), date: w.date, how: `${country.currency} ${w.value} in force since ${w.date} at ${round(r.value, 2)} per USD (${ym(r.date)})`, change12: usd12 ? round((usd / usd12 - 1) * 100, 1) : null };
    }
  }
  return d;
}

// ---- Event helpers --------------------------------------------------------------------------------------------------
function nextEvent(events, type, asOf, re) {
  const list = events.filter(e => e.event_type === type && e.event_date && e.event_date >= asOf && (!re || re.test(e.description || ''))).sort((a, b) => a.event_date < b.event_date ? -1 : 1);
  return list[0] || null;
}
function recentEvent(events, type, asOf, months) {
  const from = addMonths(asOf, -months);
  return events.filter(e => e.event_type === type && e.event_date && e.event_date >= from && e.event_date <= asOf).sort((a, b) => a.event_date < b.event_date ? 1 : -1)[0] || null;
}
function monthsTo(e, asOf) { return e ? monthsBetween(asOf, e.event_date) : null; }

// ---- Section scores -------------------------------------------------------------------------------------------------
// Each scorer returns { cost, risk, costTrend, riskTrend, inputs: {...}, notes: [...] }. Missing inputs give null scores.
function trendFromChange(change, band) {    // change in the "worsening" direction; band = dead zone
  if (change === null || change === undefined || !isFinite(change)) return 'stable';
  return change > band ? 'up' : change < -band ? 'down' : 'stable';
}

function scorePOL(S, D, E, asOf, ctx) {
  const inputs = {}, notes = [];
  let risk = null;
  const own = S.POL_STAB && S.POL_STAB.latest(asOf);
  if (own && monthsBetween(ym(own.date) + '-01', asOf) <= 3) { risk = clamp(own.value); inputs.POL_STAB = own.value; notes.push('risk from the own stability score'); }
  else {
    risk = 2; const why = [];
    const el = nextEvent(E, 'ELECTION', asOf);
    if (el) { inputs.next_election = el.event_date; if (monthsTo(el, asOf) <= 12) { risk = Math.max(risk, 3); why.push(`election within 12 months (${el.event_date})`); } }
    else notes.push('no scheduled election in the calendar');
    const sanc = S.POL_SANCTIONS && S.POL_SANCTIONS.latest(asOf);
    if (sanc) {
      inputs.POL_SANCTIONS = sanc.text; const t = sanc.text || '';
      if (/broad/i.test(t)) { risk = 5; why.push('broad sanctions'); }
      else if (/sector|trade sanction|export control|embargo on/i.test(t) && !/no trade sanction/i.test(t)) { risk = Math.max(risk, 4); why.push('sanctions touching trade or a sector'); }
      else if (/targeted/i.test(t)) { risk = Math.max(risk, 3); why.push('targeted designations of individuals or entities'); }
    }
    const sec = recentEvent(E, 'SECURITY', asOf, 18);
    if (sec) { inputs.security_event = sec.event_date; risk = Math.max(risk, 3); why.push(`security event in the last 18 months (${sec.event_date})`); }
    // unrest proxy: protest events located in the country (GDELT 2.0 event database), the last three complete months
    // against the twelve months before them; a surge of 1.5 times reads as sustained protests (3), 2.5 times as
    // violent unrest (4); the absolute floors (30 and 100 events a month) keep swings on tiny counts out while
    // leaving the rule reachable for the small-coverage countries (Cambodia and Honduras run at 20 to 80 a month)
    const un = S.POL_UNREST;
    if (un && un.length >= 9) {
      const last = addMonths(asOf, -1), recent = un.meanWindow(last, 3), base = un.meanWindow(addMonths(last, -3), 12);
      if (recent !== null && base !== null && base > 0) {
        const ratio = Math.round(recent / base * 100) / 100;
        inputs.POL_UNREST_3m = Math.round(recent); inputs.POL_UNREST_ratio = ratio;
        if (ratio >= 2.5 && recent >= 100) { risk = Math.max(risk, 4); why.push(`protest events at ${ratio} times their yearly average (GDELT)`); }
        else if (ratio >= 1.5 && recent >= 30) { risk = Math.max(risk, 3); why.push(`protest events at ${ratio} times their yearly average (GDELT)`); }
        else why.push(`protest events at ${ratio} times their yearly average (GDELT), no surge`);
      }
    }
    notes.push('risk by rule from the calendar, the sanctions flag and the unrest proxy (no own score): ' + (why.length ? why.join('; ') : 'base 2'));
  }
  let cost = null;
  const cpi = S.POL_CPI_TI && S.POL_CPI_TI.latest(asOf);
  if (cpi) { inputs.POL_CPI_TI = cpi.value; cost = bucket(cpi.value, [20, 30, 40, 50], [5, 4, 3, 2, 1]); }
  else notes.push('no corruption index: cost score empty');
  // trends: risk up when an election enters the 12-month window since 3 months ago
  const el3 = nextEvent(E, 'ELECTION', addMonths(asOf, -3));
  const riskTrend = (nextEvent(E, 'ELECTION', asOf) && monthsTo(nextEvent(E, 'ELECTION', asOf), asOf) <= 12 && el3 && monthsTo(el3, addMonths(asOf, -3)) > 12) ? 'up' : 'stable';
  return { cost, risk, costTrend: 'stable', riskTrend, inputs, notes };
}

function scoreTRD(S, D, E, asOf, ctx) {
  const inputs = {}, notes = [];
  const us = S.TRD_DEST_US && S.TRD_DEST_US.latest(asOf), eu = S.TRD_DEST_EU && S.TRD_DEST_EU.latest(asOf);
  const shareUS = us ? us.value : null, shareEU = eu ? eu.value : null;
  if (shareUS !== null) inputs.TRD_DEST_US = shareUS;
  if (shareEU !== null) inputs.TRD_DEST_EU = shareEU;
  const main = shareUS === null && shareEU === null ? null : (shareUS || 0) >= (shareEU || 0) ? 'US' : 'EU';
  // cost: effective tariff on the main market
  let cost = null, costTrend = 'stable';
  const tCode = main === 'EU' ? 'TRD_TARIFF_EU' : 'TRD_TARIFF_US';
  const t = S[tCode] && S[tCode].inForce(asOf);
  if (!main) notes.push('no destination shares: main market unknown, US tariff used');
  if (t && t.value !== null) {
    inputs[tCode] = t.value; inputs.main_market = main || 'US (assumed)';
    cost = bucket(t.value, [0.01, 5, 12, 20], [1, 2, 3, 4, 5]);
    const t6 = S[tCode].inForce(addMonths(asOf, -6));
    costTrend = trendFromChange(t6 && t6.value !== null ? t.value - t6.value : null, 0.5);
    if (t6) inputs[tCode + '_6m_ago'] = t6.value;
  } else notes.push('no effective tariff for the main market: cost score empty');
  // risk: preference security and concentration
  let risk = null;
  const pref = nextEvent(E, 'PREF_REVIEW', asOf);
  const m = monthsTo(pref, asOf);
  if (pref) {
    inputs.next_pref_review = pref.event_date; risk = m > 36 ? 1 : m > 18 ? 2 : 3;
    if (m <= 12 && /\b(loss|lapse|lapsed|lapses|expir\w*|withdraw\w*|suspen\w*)\b/i.test(pref.description || '')) { risk = 4; notes.push('preference loss, lapse, expiry or withdrawal within 12 months'); }
    else if (m <= 12) notes.push('preference review within 12 months (a graduation date is a review, not a loss: EBA and GSP run on for years after it)');
  }
  else { risk = 1; notes.push('no preference review in the calendar: preferences read as secure'); }
  const prefText = S.TRD_PREF && S.TRD_PREF.latest(asOf);
  if (prefText) { inputs.TRD_PREF = prefText.text; if (/no preference|lapsed|suspended/i.test(prefText.text || '') && /US|EU/.test(prefText.text || '') && risk < 3) { /* informational */ } }
  if ((shareUS !== null && shareUS > 50) || (shareEU !== null && shareEU > 50)) { risk = Math.max(risk, 3); notes.push('one market above 50% of apparel exports'); }
  if (shareUS === null && shareEU === null) notes.push('no destination shares: concentration not assessed');
  const riskTrend = (pref && m <= 18 && monthsTo(pref, addMonths(asOf, -3)) > 18) ? 'up' : 'stable';
  return { cost, risk, costTrend, riskTrend, inputs, notes };
}

function scoreEXT(S, D, E, asOf, ctx) {
  const inputs = {}, notes = [];
  let risk = null, riskTrend = 'stable';
  if (D.EXT_RES_MOI) {
    inputs.EXT_RES_MOI = D.EXT_RES_MOI.value; inputs.EXT_RES_MOI_how = D.EXT_RES_MOI.how;
    risk = bucket(D.EXT_RES_MOI.value, [2, 3, 4, 6], [5, 4, 3, 2, 1]);
    // trend: months of cover now vs 3 months ago
    const r3 = S.EXT_RES.latest(addMonths(asOf, -3));
    const m3 = S.TRD_IMP.meanWindow(S.TRD_IMP.lastMonth(addMonths(asOf, -3)) || addMonths(asOf, -3), 12);
    if (r3 && m3) { const moi3 = r3.value / m3; inputs.EXT_RES_MOI_3m_ago = round(moi3, 1); riskTrend = trendFromChange(moi3 - D.EXT_RES_MOI.value, 0.3); }
  } else notes.push('no reserves or imports: risk score empty');
  const imf = S.EXT_IMF && S.EXT_IMF.latest(asOf);
  if (imf) { inputs.EXT_IMF = imf.text; if (/delay|lapsed|off.?track|suspend/i.test(imf.text || '') && risk !== null) { risk = Math.min(5, risk + 1); notes.push('one notch added: IMF programme delayed or lapsed'); } }
  const restr = S.EXT_RESTR && S.EXT_RESTR.latest(asOf);
  if (restr) { inputs.EXT_RESTR = restr.text; if (!/^\s*none/i.test(restr.text || '') && risk !== null) { risk = Math.min(5, risk + 1); notes.push('one notch added: import or LC restrictions in force'); } }
  const rating = S.EXT_RATING && S.EXT_RATING.latest(asOf);
  let cost = null, costTrend = 'stable';
  if (rating) {
    const g = ratingGrade(rating.text); inputs.EXT_RATING = rating.text; inputs.rating_grade = g;
    if (g !== null) {
      if (g >= 17 && risk !== null) { risk = Math.max(risk, 4); notes.push('floor of 4: rating CCC or below'); }
      cost = g <= 10 ? 1 : g <= 13 ? 2 : g <= 15 ? 3 : g === 16 ? 4 : 5;
      notes.push('cost from the rating as a proxy for the sovereign spread (BB- or better 2, B+ and B 3, B- 4, CCC 5)');
      const r6 = S.EXT_RATING.inForce(addMonths(asOf, -6)), g6 = r6 ? ratingGrade(r6.text) : null;
      if (g6 !== null) costTrend = trendFromChange(g - g6, 0.5);
    }
  } else notes.push('no rating: cost score empty');
  return { cost, risk, costTrend, riskTrend, inputs, notes };
}

function scoreFX(S, D, E, asOf, ctx) {
  const inputs = {}, notes = [];
  const dollarised = /dollari/i.test(ctx.country.fx_regime || '');
  let risk = null, riskTrend = 'stable', cost = null, costTrend = 'stable';
  if (D.FX_12M && D.FX_VOL) {
    const dep = -D.FX_12M.value, vol = D.FX_VOL.value;
    inputs.depreciation_12m = round(dep, 1); inputs.FX_VOL = vol;
    const worst = Math.max(dep, vol);
    risk = bucket(worst, [5, 10, 20, 40], [1, 2, 3, 4, 5]);
    const par = S.FX_PARALLEL && S.FX_PARALLEL.latest(asOf);
    if (par && par.value !== null) { inputs.FX_PARALLEL = par.value; if (par.value > 15) { risk = 5; notes.push('parallel premium above 15%'); } }
    if (dollarised) notes.push('dollarised economy: currency risk scored 1 and flagged');
    // trend: depreciation over the last 3 months, annualised, against the 12-month pace
    const fx = S.FX_USD, last = fx && fx.latest(asOf);
    if (last && !dollarised) { const p3 = fx.valueAt(addMonths(ym(last.date) + '-01', -3)); if (p3) { const dep3 = (last.value / p3 - 1) * 100 * 4; inputs.depreciation_3m_annualised = round(dep3, 1); riskTrend = trendFromChange(dep3 - dep, 3); } }
    // cost: real depreciation = nominal depreciation minus the inflation differential with the US (assumed 3%)
    const cpi = S.INF_CPI && S.INF_CPI.latest(asOf);
    if (cpi) {
      const real = dep - (cpi.value - 3);
      inputs.real_depreciation_12m = round(real, 1);
      cost = real > 10 ? 1 : real > 3 ? 2 : real >= -3 ? 3 : real >= -10 ? 4 : 5;
      notes.push('cost from nominal depreciation less the inflation differential with the US (3% assumed), no REER series');
      costTrend = trendFromChange(-(inputs.depreciation_3m_annualised !== undefined ? inputs.depreciation_3m_annualised - dep : 0), 3);
    } else notes.push('no inflation: cost score empty');
  } else notes.push('no exchange rate history: scores empty');
  return { cost, risk, costTrend, riskTrend, inputs, notes };
}

function scoreINF(S, D, E, asOf, ctx) {
  const inputs = {}, notes = [];
  let risk = null, riskTrend = 'stable', cost = null, costTrend = 'stable';
  const cpi = S.INF_CPI && S.INF_CPI.latest(asOf);
  if (cpi) {
    inputs.INF_CPI = cpi.value; inputs.INF_CPI_date = ym(cpi.date);
    risk = bucket(cpi.value, [4, 7, 10, 20], [1, 2, 3, 4, 5]);
    const food = S.INF_FOOD && S.INF_FOOD.latest(asOf);
    if (food) { inputs.INF_FOOD = food.value; if (food.value > 15) { risk = Math.min(5, risk + 1); notes.push('one notch added: food inflation above 15%'); } }
    const m = ym(cpi.date) + '-01';
    const now3 = S.INF_CPI.meanWindow(m, 3), prev3 = S.INF_CPI.meanWindow(addMonths(m, -3), 3);
    if (now3 !== null && prev3 !== null) { inputs.INF_CPI_3m_avg = round(now3, 1); inputs.INF_CPI_prev3m_avg = round(prev3, 1); riskTrend = trendFromChange(now3 - prev3, 0.5); costTrend = riskTrend; }
    // cost: rank among the covered countries (quintile = rank with five pilots)
    if (ctx.ranks && ctx.ranks.INF_CPI && ctx.ranks.INF_CPI[ctx.country.iso3]) { cost = ctx.ranks.INF_CPI[ctx.country.iso3]; inputs.rank_among_covered = cost; notes.push('cost = rank of the inflation rate among the covered countries (1 = lowest)'); }
  } else notes.push('no inflation: scores empty');
  return { cost, risk, costTrend, riskTrend, inputs, notes };
}

function scoreFIN(S, D, E, asOf, ctx) {
  const inputs = {}, notes = [];
  let risk = null, riskTrend = 'stable', cost = null, costTrend = 'stable';
  const npl = S.FIN_NPL && S.FIN_NPL.latest(asOf);
  if (npl) {
    inputs.FIN_NPL = npl.value; inputs.FIN_NPL_date = ym(npl.date);
    risk = bucket(npl.value, [5, 8, 12, 20], [1, 2, 3, 4, 5]);
    const prev = S.FIN_NPL.rows.filter(r => r.date < npl.date).slice(-1)[0];
    if (prev) { inputs.FIN_NPL_previous = prev.value; riskTrend = trendFromChange(npl.value - prev.value, 0.3); }
  } else notes.push('no NPL ratio: risk score empty');
  if (D.FIN_REAL) { inputs.FIN_REAL = D.FIN_REAL.value; if (D.FIN_REAL.value < -5 && risk !== null) { risk = Math.min(5, risk + 1); notes.push('one notch added: real policy rate below minus 5%'); } }
  const lend = S.FIN_LEND && S.FIN_LEND.latest(asOf);
  let rate = null;
  if (lend) { rate = lend.value; inputs.FIN_LEND = rate; }
  else if (S.FIN_POLICY && S.FIN_POLICY.latest(asOf)) { rate = S.FIN_POLICY.latest(asOf).value + 4; inputs.FIN_POLICY = S.FIN_POLICY.latest(asOf).value; notes.push('cost from the policy rate plus 4 points as a proxy for the lending rate'); }
  else notes.push('no lending or policy rate: cost score empty');
  if (rate !== null) {
    cost = bucket(rate, [7, 10, 14, 20], [1, 2, 3, 4, 5]);
    const src = lend ? S.FIN_LEND : S.FIN_POLICY, r6 = src.latest(addMonths(asOf, -6));
    if (r6) costTrend = trendFromChange((lend ? rate : rate - 4) - r6.value, 0.25);
  }
  return { cost, risk, costTrend, riskTrend, inputs, notes };
}

function scoreLAB(S, D, E, asOf, ctx) {
  const inputs = {}, notes = [];
  let risk = null, riskTrend = 'stable', cost = null, costTrend = 'stable';
  const strikes = S.LAB_STRIKES && S.LAB_STRIKES.latest(asOf);
  if (strikes) { inputs.LAB_STRIKES = strikes.value; risk = bucket(strikes.value, [1, 3, 6, 11], [1, 2, 3, 4, 5]); }
  else { risk = 2; notes.push('no strike count: base risk 2 (occasional)'); }
  const wr = nextEvent(E, 'WAGE_REVIEW', asOf);
  if (wr) { inputs.next_wage_review = wr.event_date; if (monthsTo(wr, asOf) <= 6) { risk = Math.min(5, risk + 1); notes.push(`one notch added: wage review due within 6 months (${wr.event_date})`); } }
  const w = D.LAB_SECW_USD || D.LAB_MINW_USD;
  if (w) {
    inputs.wage_usd = w.value; inputs.wage_how = w.how; inputs.wage_code = D.LAB_SECW_USD ? 'LAB_SECW_USD' : 'LAB_MINW_USD';
    const code = D.LAB_SECW_USD ? 'LAB_SECW_USD' : 'LAB_MINW_USD';
    if (ctx.ranks && ctx.ranks.WAGE_USD && ctx.ranks.WAGE_USD[ctx.country.iso3]) { cost = ctx.ranks.WAGE_USD[ctx.country.iso3]; inputs.rank_among_covered = cost; notes.push('cost = rank of the USD wage among the covered countries (1 = cheapest)'); }
    if (w.change12 !== null && w.change12 !== undefined) { inputs.wage_usd_change_12m = w.change12; if (w.change12 > 10 && cost !== null) { cost = Math.min(5, cost + 1); notes.push('one notch added: USD wage up more than 10% over 12 months'); } costTrend = trendFromChange(w.change12, 3); }
  } else notes.push('no wage: cost score empty');
  return { cost, risk, costTrend, riskTrend, inputs, notes };
}

function scoreINV(S, D, E, asOf, ctx) {
  return { cost: null, risk: null, costTrend: 'stable', riskTrend: 'stable', inputs: {}, notes: ['no FDI, portfolio flow or business climate series loaded: scores empty'] };
}

function scoreENV(S, D, E, asOf, ctx) {
  const inputs = {}, notes = [];
  let risk = null, riskTrend = 'stable', cost = null, costTrend = 'stable';
  const out = S.ENV_OUTAGE && S.ENV_OUTAGE.latest(asOf);
  if (out && out.value !== null) {
    inputs.ENV_OUTAGE = out.value; risk = bucket(out.value, [0.5, 10, 40, 100], [1, 2, 3, 4, 5]);
    const m = ym(out.date) + '-01', now3 = S.ENV_OUTAGE.meanWindow(m, 3), prev3 = S.ENV_OUTAGE.meanWindow(addMonths(m, -3), 3);
    if (now3 !== null && prev3 !== null) riskTrend = trendFromChange(now3 - prev3, 5);
    notes.push('risk from outage hours per month (0 = 1, under 10 = 2, 10 to 40 = 3, 40 to 100 = 4, above = 5)');
  } else notes.push('no outage series: risk score empty');
  const dis = recentEvent(E, 'DISASTER', asOf, 12);
  if (dis && risk !== null) { risk = Math.max(risk, 3); notes.push('disaster event within 12 months'); }
  const el = S.ENV_ELEC && S.ENV_ELEC.inForce(asOf);
  if (el && el.value !== null) {
    inputs.ENV_ELEC = el.value;
    cost = bucket(el.value, [7, 10, 13, 17], [1, 2, 3, 4, 5]);
    const e6 = S.ENV_ELEC.inForce(addMonths(asOf, -6));
    if (e6 && e6.value !== null) costTrend = trendFromChange(el.value - e6.value, 0.5);
    notes.push('no freight series: no freight adjustment');
  } else notes.push('no electricity tariff: cost score empty');
  return { cost, risk, costTrend, riskTrend, inputs, notes };
}

const SCORERS = { POL: scorePOL, TRD: scoreTRD, EXT: scoreEXT, FX: scoreFX, INF: scoreINF, FIN: scoreFIN, LAB: scoreLAB, INV: scoreINV, ENV: scoreENV };

// ---- Composites -----------------------------------------------------------------------------------------------------
// Weights table components mapped to section scores. A component whose score is empty is left out and the weights
// of the others renormalised; the note lists what was left out.
const COST_COMPONENTS = { 'Labour cost': ['LAB'], 'Currency': ['FX'], 'Energy': ['ENV'], 'Financing': ['FIN'], 'Trade and tariffs': ['TRD'], 'Logistics and freight': [] };
const RISK_COMPONENTS = { 'Politics and geopolitics': ['POL'], 'External position': ['EXT'], 'Trade dependence and preferences': ['TRD'], 'Social climate and labour': ['LAB', 'INF'], 'Logistics and energy reliability': ['ENV'], 'Climate': [] };

function composite(sections, weights, map, field) {
  let num = 0, den = 0; const used = [], missing = [];
  for (const w of weights) {
    const secs = map[w.component];
    if (!secs) continue;
    const vals = secs.map(s => sections[s] && sections[s][field]).filter(v => v !== null && v !== undefined);
    if (!vals.length) { missing.push(w.component); continue; }
    const v = vals.reduce((a, b) => a + b, 0) / vals.length;
    num += v * Number(w.weight); den += Number(w.weight); used.push(`${w.component} ${round(v, 1)} x ${w.weight}`);
  }
  return { value: den ? round(num / den, 2) : null, covered: den, used, missing };
}
function compositeTrend(sections, map, field) {
  let up = 0, down = 0;
  for (const secs of Object.values(map)) for (const s of secs) { const t = sections[s] && sections[s][field]; if (t === 'up') up++; if (t === 'down') down++; }
  return up > down ? 'up' : down > up ? 'down' : 'stable';
}

// ---- Entry points ---------------------------------------------------------------------------------------------------
// ranks: {INF_CPI: {iso3: rank}, WAGE_USD: {iso3: rank}} computed across the covered countries before scoring.
export function scoreCountry(country, observations, events, weights, asOf, ranks) {
  const S = indexObservations(observations);
  const D = derived(S, asOf, country);
  const ctx = { country, ranks };
  const sections = {};
  for (const sec of SECTIONS) {
    const r = SCORERS[sec](S, D, events, asOf, ctx);
    sections[sec] = { cost: r.cost === null ? null : clamp(r.cost), risk: r.risk === null ? null : clamp(r.risk), costTrend: r.costTrend, riskTrend: r.riskTrend, inputs: r.inputs, notes: r.notes };
  }
  const costW = weights.filter(w => w.composite === 'Sourcing Cost Pressure'), riskW = weights.filter(w => w.composite === 'Disruption Risk');
  const cost = composite(sections, costW, COST_COMPONENTS, 'cost'), risk = composite(sections, riskW, RISK_COMPONENTS, 'risk');
  return {
    iso3: country.iso3, score_date: asOf, derived: D, sections,
    composite: { cost_pressure: cost.value, disruption_risk: risk.value, cost_trend: compositeTrend(sections, COST_COMPONENTS, 'costTrend'), risk_trend: compositeTrend(sections, RISK_COMPONENTS, 'riskTrend'),
                 cost_detail: cost, risk_detail: risk },
  };
}

// Ranks across countries for the quintile rules (1 = lowest value). 'latestBy' gives {iso3: value}.
export function rankCountries(latestBy) {
  const entries = Object.entries(latestBy).filter(([, v]) => v !== null && v !== undefined && isFinite(v)).sort((a, b) => a[1] - b[1]);
  const n = entries.length, out = {};
  entries.forEach(([iso3], i) => { out[iso3] = n <= 5 ? i + 1 : Math.min(5, Math.floor(i * 5 / n) + 1); });
  return out;
}

// The latest value of an indicator (or derived wage) per country, for the ranks.
export function latestValues(countries, obsByCountry, asOf, kind) {
  const out = {};
  for (const c of countries) {
    const S = indexObservations(obsByCountry[c.iso3] || []);
    if (kind === 'INF_CPI') { const r = S.INF_CPI && S.INF_CPI.latest(asOf); out[c.iso3] = r ? r.value : null; }
    if (kind === 'WAGE_USD') { const D = derived(S, asOf, c); const w = D.LAB_SECW_USD || D.LAB_MINW_USD; out[c.iso3] = w ? w.value : null; }
  }
  return out;
}

export { SECTIONS, Series, addMonths };
