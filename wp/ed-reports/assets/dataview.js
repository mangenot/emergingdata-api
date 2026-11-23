/* ED Reports, data view: the overview button and the explorer (one indicator, a range, the other countries).
   The charts, the contents bar, the benchmark and the scores are drawn by report.js, which runs first. */
(function () {
  'use strict';
  var root = document.querySelector('.ed-report.ed-data');
  if (!root) return;
  var btn = root.querySelector('.ov-btn'), ov = root.querySelector('.stand .ov');
  if (btn && ov) btn.addEventListener('click', function () { var open = ov.hidden; ov.hidden = !open; btn.setAttribute('aria-expanded', open ? 'true' : 'false'); btn.textContent = open ? 'Hide the full overview' : 'Read the full overview'; });

  var R = window.EDReport, box = root.querySelector('#ed-explore');
  if (!R || !box) return;
  var DATA = R.DATA, S = R.S, CMP = DATA.COMPARE || {}, ISO = DATA.ISO, NAME = DATA.NAME || ISO, CUR = DATA.CURRENCY || 'local currency';
  var EXPL = [
    { code: 'INF_CPI', title: 'Inflation', unit: 'consumer prices, % change on a year earlier', decimals: 1, cmp: true },
    { code: 'FX_REAL', title: 'Real exchange rate', unit: 'index Jan 2020 = 100, deflated by the inflation differential with the US; a rise means cheaper in dollars', decimals: 1, cmp: true },
    { code: 'FIN_POLICY', title: 'Policy rate', unit: '%, rate in force each month', decimals: 2, cmp: true, step: true },
    { code: 'TRD_APP_EXP', title: 'Apparel exports', unit: 'index, average of 2019 = 100, monthly', decimals: 0, cmp: true, index: true },
    { code: 'EXT_RES', title: 'Reserves', unit: 'USD million', decimals: 0 },
    { code: 'FX_USD', title: 'Exchange rate', unit: CUR + ' per USD, monthly average', decimals: 2 },
    { code: 'POL_UNREST', title: 'Protest events', unit: 'events located in the country per month (GDELT)', decimals: 0, cmp: true }
  ];
  var sel = box.querySelector('.ind'), cmp = box.querySelector('.cmp'), out = box.querySelector('.explore-chart'), months = 36;
  EXPL.forEach(function (e, k) { if (S[e.code]) sel.insertAdjacentHTML('beforeend', '<option value="' + k + '">' + R.esc(e.title) + '</option>'); });
  if (!sel.options.length) { box.hidden = true; return; }
  var COLORS = ['var(--series-1)', 'var(--series-2)', '#5b7fa6', '#8dbb4f', '#a04a9c', '#c43d3d'];
  function toPts(s) { var p = []; if (!s) return p; if (s.values) { var o = R.mIndex(s.start); s.values.forEach(function (v, j) { if (v != null) p.push({ i: o + j, v: v }); }); } else if (s.points) s.points.forEach(function (q) { p.push({ i: R.mIndex(q[0]), v: q[1] }); }); return p; }
  function indexed(p) { var base = p.filter(function (q) { return q.i >= 0 && q.i < 12; }); var b = base.length ? base.reduce(function (a, q) { return a + q.v; }, 0) / base.length : (p[0] ? p[0].v : 1); return p.map(function (q) { return { i: q.i, v: q.v / b * 100 }; }); }
  function draw() {
    var e = EXPL[+sel.value]; out.innerHTML = '';
    var on = cmp.checked && e.cmp && Object.keys(CMP).length > 1;
    cmp.disabled = !e.cmp || Object.keys(CMP).length < 2;
    var series = [];
    if (on) {
      var isos = Object.keys(CMP).sort(function (a, b) { return a === ISO ? -1 : b === ISO ? 1 : a.localeCompare(b); });
      isos.forEach(function (iso, k) { var p = toPts(CMP[iso][e.code]); if (!p.length) return; if (e.index) p = indexed(p); series.push({ name: CMP[iso].name || iso, pts: p, color: COLORS[k % COLORS.length] }); });
    } else {
      var p = toPts(S[e.code]); if (e.index) p = indexed(p);
      series.push({ name: NAME, pts: p });
    }
    R.chart(out, { title: e.title + (on ? ', the countries covered' : ''), unit: e.unit, decimals: e.decimals, step: e.step, series: series }, { months: months });
  }
  sel.addEventListener('change', draw);
  cmp.addEventListener('change', draw);
  box.querySelector('.range').addEventListener('click', function (ev) { var b = ev.target.closest('button'); if (!b) return; months = +b.getAttribute('data-m'); box.querySelectorAll('.range button').forEach(function (x) { x.classList.toggle('on', x === b); }); draw(); });
  draw();
})();
