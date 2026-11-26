/* ED Reports, the home page: the chart of the opening band (the currencies in real terms, rebased three years ago),
   drawn from the JSON block #ed-home-data written by [ed_home_hero]. */
(function () {
  'use strict';
  var block = document.getElementById('ed-home-data'), box = document.getElementById('ed-home-chart');
  if (!block || !box) return;
  var A; try { A = JSON.parse(block.textContent); } catch (e) { return; }
  if (!A.series || !A.series.length) { box.style.display = 'none'; return; }

  var BASE = 2019, MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var fmt = function (x, d) { return x == null ? '–' : Number(x).toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }); };
  var mIndex = function (ym) { return (+ym.slice(0, 4) - BASE) * 12 + (+ym.slice(5, 7) - 1); };
  var mLabel = function (i) { return MONTHS[((i % 12) + 12) % 12] + ' ' + (BASE + Math.floor(i / 12)); };
  function points(s) { var out = [], o = mIndex(s.start); s.values.forEach(function (v, k) { if (v != null) out.push({ i: o + k, v: v }); }); return out; }
  function rebased(pts, months) { var end = pts[pts.length - 1].i, b = null; pts.forEach(function (p) { if (b === null && p.i >= end - months + 1) b = p; }); return pts.filter(function (p) { return p.i >= end - months + 1; }).map(function (p) { return { i: p.i, v: p.v / b.v * 100 }; }); }
  function niceStep(range, n) { var raw = range / n, p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }

  var MONTHS_BACK = 36;
  var series = A.series.map(function (s) { var p = points(s.fx_real); return p.length > 13 ? { name: s.name, color: s.color, pts: rebased(p, MONTHS_BACK) } : null; }).filter(Boolean);
  if (!series.length) { box.style.display = 'none'; return; }
  var endI = Math.max.apply(null, series.map(function (s) { return s.pts[s.pts.length - 1].i; }));
  var X0 = endI - MONTHS_BACK + 1, NX = endI + 1, span = NX - X0;
  var all = []; series.forEach(function (s) { s.pts.forEach(function (p) { all.push(p.v); }); });
  var min = Math.min.apply(null, all), max = Math.max.apply(null, all);
  var step = niceStep((max - min) || 1, 4), y0 = Math.floor(min / step) * step, y1 = Math.ceil(max / step) * step; if (y1 - max < step * .1) y1 += step;
  var W = 520, H = 270, PR = 40, PT = 10, PB = 24, labels = []; for (var v = y0; v <= y1 + 1e-9; v += step) labels.push(fmt(v, 0));
  var PL = 8 + 6.4 * Math.max.apply(null, labels.map(function (l) { return l.length; }));
  var xOf = function (i) { return PL + (i - X0) * (W - PL - PR) / Math.max(1, span - 1); }, yOf = function (val) { return PT + (y1 - val) / (y1 - y0) * (H - PT - PB); };
  var g = '', yb = yOf(y0).toFixed(1);
  labels.forEach(function (l, k) { var yy = yOf(y0 + k * step).toFixed(1); g += '<line class="grid" x1="' + PL + '" x2="' + (W - PR) + '" y1="' + yy + '" y2="' + yy + '"/><text class="tick" x="' + (PL - 6) + '" y="' + (+yy + 3.5).toFixed(1) + '">' + l + '</text>'; });
  if (100 >= y0 && 100 <= y1) { var yh = yOf(100).toFixed(1); g += '<line class="axis base" x1="' + PL + '" x2="' + (W - PR) + '" y1="' + yh + '" y2="' + yh + '"/>'; }
  g += '<line class="axis" x1="' + PL + '" x2="' + (W - PR) + '" y1="' + yb + '" y2="' + yb + '"/>';
  var firstYear = BASE + Math.ceil(X0 / 12);
  for (var yr = firstYear; yr <= BASE + Math.floor((NX - 1) / 12); yr++) { var xi = xOf((yr - BASE) * 12).toFixed(1); g += '<line class="axis" x1="' + xi + '" x2="' + xi + '" y1="' + yb + '" y2="' + (+yb + 4) + '"/><text class="xl" x="' + xi + '" y="' + (H - 7) + '">' + yr + '</text>'; }
  var paths = '', ends = '';
  series.forEach(function (s) {
    var p = ''; s.pts.forEach(function (q, k) { p += (k ? 'L' : 'M') + xOf(q.i).toFixed(1) + ' ' + yOf(q.v).toFixed(1); });
    paths += '<path class="l" style="stroke:' + s.color + '" d="' + p + '"/>';
    var e = s.pts[s.pts.length - 1];
    ends += '<circle class="end" style="fill:' + s.color + '" cx="' + xOf(e.i).toFixed(1) + '" cy="' + yOf(e.v).toFixed(1) + '" r="4"/>';
  });
  box.innerHTML = '<div class="chart-head"><h3>The five currencies in real terms</h3><span class="last num">to ' + mLabel(endI) + '</span></div>' +
    '<div class="chart-unit">real exchange rate against the dollar, index three years ago = 100; a rise means cheaper in dollars, a fall dearer</div>' +
    '<div class="legend">' + series.map(function (s) { return '<span><i style="background:' + s.color + '"></i>' + esc(s.name) + '</span>'; }).join('') + '</div>' +
    '<div class="chart-body"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="The five currencies in real terms">' + g + paths + ends +
    '<g class="hover" style="display:none"><line class="cross" y1="' + PT + '" y2="' + yb + '"/>' + series.map(function (s) { return '<circle class="end" style="fill:' + s.color + '" r="4"/>'; }).join('') + '</g></svg><div class="tip"></div></div>';
  var svg = box.querySelector('svg'), hov = box.querySelector('.hover'), tip = box.querySelector('.tip'), cross = hov.querySelector('line'), dots = hov.querySelectorAll('circle');
  function nearest(s, i) { var best = null; s.pts.forEach(function (p) { if (best === null || Math.abs(p.i - i) < Math.abs(best.i - i)) best = p; }); return best && Math.abs(best.i - i) <= 1.5 ? best : null; }
  function hide() { hov.style.display = 'none'; tip.style.display = 'none'; }
  function show(e) {
    var r = svg.getBoundingClientRect(), px = (e.clientX - r.left) * W / r.width;
    var i = Math.round(X0 + (px - PL) / (W - PL - PR) * (span - 1)); i = Math.max(X0, Math.min(NX - 1, i));
    var any = false, html = '', ti = i;
    series.forEach(function (s, si) { var p = nearest(s, i); if (p) { any = true; ti = p.i; dots[si].style.display = ''; dots[si].setAttribute('cx', xOf(p.i).toFixed(1)); dots[si].setAttribute('cy', yOf(p.v).toFixed(1)); html += '<br>' + esc(s.name) + ' ' + fmt(p.v, 0); } else dots[si].style.display = 'none'; });
    if (!any) return hide();
    cross.setAttribute('x1', xOf(ti).toFixed(1)); cross.setAttribute('x2', xOf(ti).toFixed(1)); hov.style.display = '';
    tip.innerHTML = '<strong>' + mLabel(ti) + '</strong>' + html; tip.style.display = 'block';
    var fx = xOf(ti) / W * 100; if (fx > 62) { tip.style.left = 'auto'; tip.style.right = (100 - fx + 1.5) + '%'; } else { tip.style.right = 'auto'; tip.style.left = (fx + 1.5) + '%'; }
  }
  svg.addEventListener('pointermove', show); svg.addEventListener('pointerdown', show); svg.addEventListener('pointerleave', hide);
})();
