(function () {
  'use strict';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function lvl(v) { return v == null ? 'none' : 's' + Math.min(5, Math.max(1, Math.round(v))); }
  function arrow(t) { return t === 'up' ? '↑' : t === 'down' ? '↓' : '→'; }
  function fmt(v, d) { return v == null ? '–' : Number(v).toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function chip(v, t) { return '<span class="chipw"><span class="chip ' + lvl(v) + '">' + (v == null ? '–' : v) + '</span>' + (v == null ? '' : '<span class="arrow">' + arrow(t) + '</span>') + '</span>'; }
  function mIndex(ym) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7); return (y - 2019) * 12 + (m - 1); }
  function monthLabel(i) { return MONTHS[i % 12] + ' ' + (2019 + Math.floor(i / 12)); }

  var ISO = DATA.ISO, TODAY = DATA.TODAY, S = DATA.SERIES, EVENTS = DATA.EVENTS, SC = DATA.SCORES, BENCH = DATA.BENCH;

  /* ---------- events: per chapter, and the full calendar ---------- */
  function evRow(e) {
    var p = e[0].split('-'), dd = +p[2] + ' ' + MONTHS[+p[1] - 1] + ' ' + p[0];
    return '<div class="ev"><span class="d">' + dd + (e[4] ? '<small>date approximate</small>' : '') + '</span><span class="t">' + esc(e[1]) + '<div class="tags">' + esc(e[3]) + '</div></span></div>';
  }
  var byDateAsc = function (a, b) { return a[0] < b[0] ? -1 : 1; }, byDateDesc = function (a, b) { return a[0] > b[0] ? -1 : 1; };
  document.querySelectorAll('.events[data-ch]').forEach(function (el) {
    var ch = +el.getAttribute('data-ch');
    var ahead = EVENTS.filter(function (e) { return e[2] === ch && e[0] >= TODAY; }).sort(byDateAsc);
    var behind = EVENTS.filter(function (e) { return e[2] === ch && e[0] < TODAY; }).sort(byDateDesc);
    var html = '';
    if (ahead.length) html += '<h3>Ahead</h3>' + ahead.map(evRow).join('');
    if (behind.length) html += '<h3>Behind</h3>' + behind.map(evRow).join('');
    el.innerHTML = html;
  });
  if (document.getElementById('ahead')) document.getElementById('ahead').innerHTML = EVENTS.filter(function (e) { return e[0] >= TODAY; }).sort(byDateAsc).map(evRow).join('');
  if (document.getElementById('behind')) document.getElementById('behind').innerHTML = EVENTS.filter(function (e) { return e[0] < TODAY; }).sort(byDateDesc).map(evRow).join('');

  /* ---------- charts: each chart runs from the January of its first observation to December 2026 ---------- */
  var NX = mIndex('2026-12') + 1;
  var W = 360, H = 190, PR = 46, PT = 10, PB = 24;
  function niceStep(range, n) { var raw = range / n, p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }

  // a series as drawn: [{i: month index, v: value}] from either a contiguous run or dated points
  function points(code, scale) {
    var s = S[code]; if (!s) return null;
    var out = [];
    if (s.values) { var o = mIndex(s.start); s.values.forEach(function (v, k) { if (v != null) out.push({ i: o + k * (s.every || 1), v: v * scale }); }); }
    else if (s.points) s.points.forEach(function (p) { out.push({ i: mIndex(p[0]), v: p[1] * scale }); });
    return out.length ? out : null;
  }

  function chart(container, spec) {
    var series = [];
    spec.series.forEach(function (s) { var p = points(s.code, s.scale || 1); if (p) series.push({ name: s.name, pts: p }); });
    if (!series.length) return;
    var all = [], first = NX; series.forEach(function (s) { s.pts.forEach(function (p) { all.push(p.v); if (p.i < first) first = p.i; }); });
    var X0 = Math.floor(first / 12) * 12, span = NX - X0;                    // January of the first year with data
    var min = Math.min.apply(null, all), max = Math.max.apply(null, all);
    if (spec.zero) min = Math.min(0, min);
    var step = niceStep((max - min) || Math.abs(max) || 1, 4), y0 = Math.floor(min / step) * step, y1 = Math.ceil(max / step) * step;
    if (y1 - max < step * 0.1) y1 += step;
    if (y0 === y1) y1 = y0 + step;
    var d = spec.decimals, td = spec.tickDecimals == null ? d : spec.tickDecimals;
    var labels = []; for (var v = y0; v <= y1 + 1e-9; v += step) labels.push(fmt(v, td));
    var PL = 8 + 6.2 * Math.max.apply(null, labels.map(function (l) { return l.length; }));   // left gutter sized to the longest tick label
    function xOf(i) { return PL + (i - X0) * (W - PL - PR) / (span - 1); }
    function yOf(v) { return PT + (y1 - v) / (y1 - y0) * (H - PT - PB); }
    var g = '', yb = yOf(y0).toFixed(1);
    labels.forEach(function (l, k) {
      var yy = yOf(y0 + k * step).toFixed(1);
      g += '<line class="grid" x1="' + PL + '" x2="' + (W - PR) + '" y1="' + yy + '" y2="' + yy + '"/>';
      g += '<text class="tick" x="' + (PL - 6) + '" y="' + (+yy + 3.5).toFixed(1) + '">' + l + '</text>';
    });
    g += '<line class="axis" x1="' + PL + '" x2="' + (W - PR) + '" y1="' + yb + '" y2="' + yb + '"/>';
    var years = span / 12, every = years > 6 ? 2 : 1;                       // a label every year, every second year on long axes
    for (var yr = 2019 + X0 / 12; yr <= 2026; yr++) {
      var xi = xOf((yr - 2019) * 12).toFixed(1);
      g += '<line class="axis" x1="' + xi + '" x2="' + xi + '" y1="' + yb + '" y2="' + (+yb + 4) + '"/>';
      if ((yr - 2019 - X0 / 12) % every === 0) g += '<text class="xl" x="' + xi + '" y="' + (H - 7) + '"' + (yr === 2019 + X0 / 12 ? ' style="text-anchor:start"' : '') + '>' + yr + '</text>';
    }
    var paths = '', ends = '', area = '';
    series.forEach(function (s, si) {
      var p = '';
      s.pts.forEach(function (q, k) {
        var x = xOf(q.i).toFixed(1), y = yOf(q.v).toFixed(1);
        if (k === 0) p += 'M' + x + ' ' + y;
        else if (spec.step) p += 'H' + x + 'V' + y;
        else p += 'L' + x + ' ' + y;
      });
      if (series.length === 1 && !spec.step) area = '<path class="a1" d="' + p + 'V' + yb + 'H' + xOf(s.pts[0].i).toFixed(1) + 'Z"/>';
      paths += '<path class="l' + (si + 1) + '" d="' + p + '"/>';
      var last = s.pts[s.pts.length - 1];
      ends += '<circle class="end' + (si ? '2' : '') + '" cx="' + xOf(last.i).toFixed(1) + '" cy="' + yOf(last.v).toFixed(1) + '" r="4"/>';
      ends += '<text class="endl" x="' + (xOf(last.i) + 8).toFixed(1) + '" y="' + (yOf(last.v) + 4).toFixed(1) + '">' + fmt(last.v, d) + '</text>';
    });
    var ref = series[0], lastP = ref.pts[ref.pts.length - 1];
    var ago = null; ref.pts.forEach(function (q) { if (q.i === lastP.i - 12) ago = q; });
    var change = '';
    if (ago) {
      var pts = /%/.test(spec.unit || ''), dv = pts ? lastP.v - ago.v : (ago.v ? (lastP.v - ago.v) / Math.abs(ago.v) * 100 : null);
      if (dv === null) change = '';
      else if (Math.abs(dv) < 0.05) change = 'unchanged on a year earlier';
      else change = (dv > 0 ? '+' : '\u2212') + Math.abs(dv).toFixed(1) + (pts ? ' pts' : '%') + ' on a year earlier';
    }
    var el = document.createElement('div'); el.className = 'chart';
    el.innerHTML = '<div class="chart-head"><h3>' + esc(spec.title) + '</h3><span class="last">' + fmt(lastP.v, d) + ' · ' + monthLabel(lastP.i) + '</span></div>' +
      '<div class="chart-unit">' + esc(spec.unit) + (change ? ' <span class="chg">' + change + '</span>' : '') + '</div>' +
      (series.length > 1 ? '<div class="legend">' + series.map(function (s, i) { return '<span><i class="' + (i ? 'c2' : '') + '"></i>' + esc(s.name) + '</span>'; }).join('') + '</div>' : '') +
      '<div class="chart-body"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(spec.title) + '">' + area + g + paths + ends +
      '<g class="hover" style="display:none"><line class="cross" y1="' + PT + '" y2="' + yb + '"/>' + series.map(function (s, i) { return '<circle class="dot ' + (i ? 'end2' : 'end') + '" r="4"/>'; }).join('') + '</g></svg><div class="tip"></div></div>';
    container.appendChild(el);

    var svg = el.querySelector('svg'), hov = el.querySelector('.hover'), tip = el.querySelector('.tip'), cross = hov.querySelector('line'), dots = hov.querySelectorAll('circle');
    function nearest(s, i) { var best = null; s.pts.forEach(function (p) { if (best === null || Math.abs(p.i - i) < Math.abs(best.i - i)) best = p; }); return best && Math.abs(best.i - i) <= 1.5 * ((S[spec.series[0].code] || {}).every || 1) ? best : null; }
    function show(e) {
      var rect = svg.getBoundingClientRect(), px = (e.clientX - rect.left) * W / rect.width;
      var i = Math.round(X0 + (px - PL) / (W - PL - PR) * (span - 1)); i = Math.max(X0, Math.min(NX - 1, i));
      var any = false, html = '', ti = i;
      series.forEach(function (s, si) {
        var p = nearest(s, i);
        if (p) { any = true; ti = p.i; dots[si].style.display = ''; dots[si].setAttribute('cx', xOf(p.i).toFixed(1)); dots[si].setAttribute('cy', yOf(p.v).toFixed(1)); html += '<br>' + (series.length > 1 ? esc(s.name) + ' ' : '') + fmt(p.v, d); }
        else dots[si].style.display = 'none';
      });
      if (!any) { hide(); return; }
      cross.setAttribute('x1', xOf(ti).toFixed(1)); cross.setAttribute('x2', xOf(ti).toFixed(1)); hov.style.display = '';
      tip.innerHTML = '<strong>' + monthLabel(ti) + '</strong>' + html; tip.style.display = 'block';
      var fx = xOf(ti) / W * 100;
      if (fx > 62) { tip.style.left = 'auto'; tip.style.right = (100 - fx + 1.5) + '%'; } else { tip.style.right = 'auto'; tip.style.left = (fx + 1.5) + '%'; }
    }
    function hide() { hov.style.display = 'none'; tip.style.display = 'none'; }
    svg.addEventListener('pointermove', show); svg.addEventListener('pointerdown', show); svg.addEventListener('pointerleave', hide);
  }
  document.querySelectorAll('.charts[data-charts]').forEach(function (el) {
    el.getAttribute('data-charts').split(',').forEach(function (code) { var sp = DATA.CHARTS[code.trim()]; if (sp) chart(el, sp); });
  });

  /* ---------- appendix: benchmark ---------- */
  function pill(v, t) { return '<span class="pill ' + lvl(v) + '">' + v.toFixed(1) + '</span> <span class="arrow">' + arrow(t) + '</span>'; }
  var rows = BENCH.slice().sort(function (a, b) { return a.cost - b.cost; });
  document.getElementById('bench').innerHTML =
    '<thead><tr><th>Country</th><th>Cost pressure</th><th>Disruption risk</th><th>Wage, USD a month</th><th>Inflation, %</th><th>Reserves, months of imports</th><th>Depreciation, 12 months, %</th><th>Real move, 12 months, %</th><th>Public debt, % of GDP</th><th>Tariff, main market, %</th><th>NPL ratio, %</th><th>Apparel exports, 12 months, USD m</th></tr></thead><tbody>' +
    rows.map(function (r) {
      return '<tr' + (r.iso === ISO ? ' class="me"' : '') + '><td>' + esc(r.name) + '</td>' +
        '<td>' + pill(r.cost, r.costT) + '</td><td>' + pill(r.risk, r.riskT) + '</td>' +
        '<td>' + fmt(r.wage, 0) + '<span class="sub">' + esc(r.wageLocal) + '</span></td>' +
        '<td>' + fmt(r.cpi, 1) + '<span class="sub">' + r.cpiDate + '</span></td>' +
        '<td>' + fmt(r.moi, 1) + '</td>' +
        '<td>' + (r.dep < 0 ? '−' + fmt(-r.dep, 1) : fmt(r.dep, 1)) + (r.iso === 'KHM' ? '<span class="sub">dollarised</span>' : '') + '</td>' +
        (function () { var real = (1 - (1 + r.dep / 100) * 1.03 / (1 + r.cpi / 100)) * 100; return '<td>' + (real < 0 ? '−' + fmt(-real, 1) : '+' + fmt(real, 1)) + '<span class="sub">' + (real > 0 ? 'dearer in USD' : 'cheaper in USD') + '</span></td>'; })() +
        '<td>' + fmt(r.gdebt, 0) + '<span class="sub">' + r.gdebtY + '</span></td>' +
        '<td>' + fmt(r.tariff, 0) + '<span class="sub">' + r.market + '</span></td>' +
        '<td>' + fmt(r.npl, 1) + (r.nplDate ? '<span class="sub">' + r.nplDate + '</span>' : '<span class="sub">not loaded</span>') + '</td>' +
        '<td>' + fmt(r.app, 0) + '<span class="sub">' + (r.appChg == null ? '' : (r.appChg >= 0 ? '+' : '−') + Math.abs(r.appChg).toFixed(0) + '% · ') + r.appDate + '</span></td></tr>';
    }).join('') + '</tbody>';

  /* ---------- appendix: scores ---------- */
  function word(t, kind) { if (t === 'stable') return 'stable'; if (kind === 'cost') return t === 'down' ? 'easing' : 'rising'; return t === 'down' ? 'falling' : 'rising'; }
  document.getElementById('comps').innerHTML =
    '<span>Sourcing cost pressure <b class="num">' + SC.cost.toFixed(1) + '</b> of 5, ' + arrow(SC.costT) + ' ' + word(SC.costT, 'cost') + '</span>' +
    '<span>Disruption risk <b class="num">' + SC.risk.toFixed(1) + '</b> of 5, ' + arrow(SC.riskT) + ' ' + word(SC.riskT, 'risk') + '</span>';
  document.getElementById('sectable').innerHTML =
    '<thead><tr><th>Section</th><th>Cost</th><th>Risk</th><th style="text-align:left">Inputs</th></tr></thead><tbody>' +
    SC.sections.map(function (s) {
      return '<tr><td>' + esc(s[1]) + '<span class="sub">' + s[0] + '</span></td><td>' + chip(s[2], s[3]) + '</td><td>' + chip(s[4], s[5]) + '</td><td style="text-align:left;color:var(--muted)">' + esc(s[6]) + '</td></tr>';
    }).join('') + '</tbody>';

  /* printing from a browser: open every section first, close again afterwards */
  var wasOpen = [];
  window.addEventListener('beforeprint', function () { wasOpen = []; document.querySelectorAll('details').forEach(function (d) { wasOpen.push(d.open); d.open = true; }); });
  window.addEventListener('afterprint', function () { document.querySelectorAll('details').forEach(function (d, i) { d.open = !!wasOpen[i]; }); });
})();

