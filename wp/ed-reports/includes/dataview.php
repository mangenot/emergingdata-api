<?php
/**
 * The data view of a report: the selected data, the overview excerpt with the full text behind a button, then every
 * section in full with its lead, a few paragraphs, the month's updates, the figures as a table, the charts and the
 * risks; then what changed, the explorer across the five countries, the benchmark, the scores, the standing facts
 * and the sources. The texts come from the post content (parsed), the figures from the API data of the country.
 */
if (!defined('ABSPATH')) exit;

/** The reader's view of a report: 'data' or 'report', from the address or the default setting. */
function ed_reports_view(): string {
    $q = get_query_var('ed_view');
    if ($q === '' || $q === null) $q = isset($_GET['view']) ? sanitize_key($_GET['view']) : '';
    if ($q === 'report' || $q === 'data') return $q;
    return ED_Api::setting('default_view') === 'report' ? 'report' : 'data';
}

/** The address of a report in one view. */
function ed_reports_view_url(WP_Post $post, string $view): string {
    $base = get_permalink($post);
    if ($view === 'report') return get_option('permalink_structure') ? trailingslashit($base) . 'report/' : add_query_arg('view', 'report', $base);
    return $base;
}

/** A figure's line in the table: name, latest value, change on the month, three-month trend, note. */
function ed_reports_fig_row(array $f, array $S): string {
    $tr = $f['code'] !== '' ? ED_Calc::series_trend($S, $f['code']) : null;
    $value = $f['value'];
    if ($value === 'auto' && $f['code'] !== '') { [$value, $month] = ED_Render::auto_value($f['code'], $f['decimals'], $f['scale'] !== '' ? (float) $f['scale'] : null); if ($f['note'] === '') $f['note'] = esc_html($month); }
    $value = preg_replace('/^((?:USD|EUR|HNL|BDT|KES|KHR|PKR|L)\s)/', '<span class="cur">$1</span>', $value);
    $value = preg_replace('/\s(bn|m|million|billion|TEU|GW|pts)$/', ' <small>$1</small>', $value);
    if ($tr) { $chg = '<span class="dir ' . $tr['dir'] . '">' . ED_Calc::ARROW[$tr['dir']] . '</span> ' . esc_html(ED_Calc::minus($tr['change'])); $short = $tr['short']; }
    elseif ($f['trend']) { $chg = '<span class="dir ' . $f['trend']['dir'] . '">' . ED_Calc::ARROW[$f['trend']['dir']] . '</span> ' . esc_html(ED_Calc::minus($f['trend']['change'])); $short = $f['trend']['short']; }
    else { $chg = ''; $short = ''; }
    $word = $short !== '' ? ED_Calc::WORD[$short] : '';
    return '<tr><td class="name">' . esc_html($f['label']) . ($f['unit'] !== '' ? '<small>' . esc_html($f['unit']) . '</small>' : '') . '</td>'
         . '<td class="val">' . ($value === '' ? '&ndash;' : $value) . '</td><td class="chg">' . $chg . '</td>'
         . '<td class="w ' . esc_attr($short) . '">' . esc_html($word) . '</td><td class="nt">' . $f['note'] . '</td></tr>';
}

function ed_reports_fig_table(array $figs, array $S): string {
    if (!$figs) return '';
    $rows = '';
    foreach ($figs as $f) $rows .= ed_reports_fig_row($f, $S);
    return '<div class="scroll"><table class="figs-t"><thead><tr><th>Figure</th><th class="r">Latest</th><th>On the month</th><th>3 months</th><th>Note</th></tr></thead><tbody>' . $rows . '</tbody></table></div>';
}

/** A selected-data line. */
function ed_reports_sel_row(string $name, string $sub, string $value, string $chg): string {
    return '<div><span class="n">' . $name . '<span class="d">' . $sub . '</span></span><span class="v num">' . $value . ($chg !== '' ? '<span class="chg">' . $chg . '</span>' : '') . '</span></div>';
}

function ed_reports_dir_span(string $dir, string $text): string {
    return '<span class="dir ' . $dir . '">' . ED_Calc::ARROW[$dir] . '</span> ' . esc_html(ED_Calc::minus($text));
}

/** The latest observation of a series at or before the current month: [value, month] or [null, null]. */
function ed_reports_last_actual(array $S, string $code, string $this_month): array {
    $s = $S[$code] ?? null;
    if (!$s) return [null, null];
    if (isset($s['points'])) { $last = [null, null]; foreach ($s['points'] as $p) if ($p[0] <= $this_month && $p[1] !== null) $last = [$p[1], $p[0]]; return $last; }
    $n = min(count($s['values']) - 1, ED_Calc::months_between($s['start'], $this_month));
    for ($i = $n; $i >= 0; $i--) if ($s['values'][$i] !== null) return [$s['values'][$i], ED_Calc::add_months($s['start'], $i)];
    return [null, null];
}

/** The whole body of the data view (after the title block). */
function ed_reports_data_view(WP_Post $post): string {
    ED_Render::begin($post->ID);
    $D = ED_Render::data();
    $S = ED_Render::series();
    $R = ED_Parse::report($post->post_content);
    foreach ($R['charts'] as $code => $spec) ED_Render::add_chart($code, $spec);
    $s = ED_Api::settings();
    $this_month = current_time('Y-m');
    $report_url = ed_reports_view_url($post, 'report');
    $out = '';

    // ---- selected data
    $rows = [];
    $F = $D['currency_figures'] ?? null;
    if ($F) {
        $rows[] = ed_reports_sel_row('Exchange rate', esc_html($F['code'] . ' per USD, ' . ED_Calc::month_label($F['when'])), ED_Calc::fmt($F['now'], 2), isset($F['dep1']) && $F['dep1'] !== null ? ed_reports_dir_span(ED_Calc::direction($F['dep1'], false, 0.5), ED_Calc::pct($F['dep1']) . ' on the month') : '');
        if (isset($F['dep12']) && $F['dep12'] !== null) $rows[] = ed_reports_sel_row('Nominal move, 12 months', $F['dep12'] >= 0 ? 'weaker against the dollar' : 'stronger against the dollar', ED_Calc::pct($F['dep12']), '');
        if (isset($F['real_move']) && $F['real_move'] !== null) $rows[] = ed_reports_sel_row('Real move, 12 months', esc_html(($F['real_move'] >= 0 ? 'dearer' : 'cheaper') . ' in dollars; inflation ' . number_format($F['cpi'], 1) . '% against 3% in the US'), ED_Calc::pct($F['real_move']), '');
        $w = $F['wage'] ?? null;
        if ($w && !empty($w['now'])) $rows[] = ed_reports_sel_row(esc_html($w['label'] ?? 'Minimum wage'), 'USD a month, at the latest rate', 'USD ' . ED_Calc::fmt($w['now'], 0), isset($w['chg']) && $w['chg'] !== null ? ed_reports_dir_span(ED_Calc::direction($w['chg'], false, 0.5), ED_Calc::pct($w['chg']) . ' on a year earlier, in dollars') : '');
    }
    $meta = $D['indicators'] ?? [];
    $selected = array_filter(array_map('trim', explode(',', strtoupper((string) get_post_meta($post->ID, '_ed_selected', true)))));
    if (!$selected) {
        $cands = [];
        foreach ($S as $code => $ser) {
            if (in_array($code, ['FX_REAL', 'FX_USD'], true) || empty($meta[$code]) || !preg_match('/month|week|daily/i', $meta[$code]['frequency'] ?? '')) continue;
            [$v, $m] = ed_reports_last_actual($S, $code, $this_month);
            if ($v !== null) $cands[$code] = $m;
        }
        arsort($cands);
        $selected = array_slice(array_keys($cands), 0, 6);
    }
    foreach ($selected as $code) {
        if (empty($S[$code])) continue;
        [$v, $m] = ed_reports_last_actual($S, $code, $this_month);
        if ($v === null) continue;
        $tr = ED_Calc::series_trend($S, $code);
        $rate = in_array($code, ED_Calc::RATE_CODES, true);
        $rows[] = ed_reports_sel_row(esc_html($meta[$code]['name'] ?? $code), esc_html(ED_Calc::month_label($m) . ' · ' . ($meta[$code]['unit'] ?? '')), ED_Calc::fmt($v, $rate ? 2 : (abs($v) >= 100 ? 0 : 2)), $tr ? ed_reports_dir_span($tr['dir'], $tr['change']) : '');
    }
    if ($rows) $out .= '<section class="strip" aria-label="Selected data"><div class="card"><span class="label">Selected data</span><div class="latest two-col">' . implode('', $rows) . '</div></div></section>';

    // ---- overview
    if ($R['overview']) {
        $ov = $R['overview'];
        $body = '';
        foreach ($ov['paras'] as [$h, $ps]) { if ($h !== '') $body .= '<h3>' . $h . '</h3>'; foreach ($ps as $p) $body .= '<p>' . $p . '</p>'; }
        if ($ov['byline'] !== '') $body .= '<p class="small">' . $ov['byline'] . '</p>';
        $out .= '<section class="stand" id="overview" data-short="Overview"><h2>Overview <span class="date">' . esc_html($ov['date']) . '</span></h2>'
              . ($ov['standfirst'] !== '' ? '<p class="excerpt">' . $ov['standfirst'] . '</p>' : '')
              . '<div class="more"><button type="button" class="btn ov-btn" aria-expanded="false">Read the full overview</button></div>'
              . '<div class="ov" hidden>' . $body . '</div></section>';
    }

    // ---- sections
    $n_paras = max(0, (int) $s['data_paragraphs']);
    $out .= '<div class="sections">';
    foreach ($R['sections'] as $n => $sec) {
        $num = $n + 1;
        $figs = $sec['figs'];
        $ups = $sec['updates'];
        if ($sec['key'] === 'EXT' && $F) { [$tfigs, $upd] = ED_Calc::trade_tiles($F); if ($upd) array_unshift($ups, $upd); $figs = array_merge(array_map(fn($t) => ['label' => $t['label'], 'value' => $t['value'], 'unit' => $t['unit'] ?? '', 'code' => '', 'note' => $t['note'], 'decimals' => 0, 'scale' => '', 'trend' => $t['trend']], $tfigs), $figs); }
        usort($ups, fn($x, $y) => (ED_Calc::DIR_ORDER[$x[0]] ?? 1) <=> (ED_Calc::DIR_ORDER[$y[0]] ?? 1));
        $out .= '<section class="sec" id="c' . $num . '" data-key="' . esc_attr($sec['key']) . '" data-short="' . esc_attr($num . ' ' . $sec['short']) . '">';
        $out .= '<div class="head"><h2><span class="n">' . $num . '</span>' . esc_html($sec['title']) . '</h2><a href="' . esc_url($report_url . '#c' . $num) . '">Full analysis in the report &#8599;</a></div>';
        if ($sec['lead'] !== '') $out .= '<p class="lead">' . $sec['lead'] . '</p>';
        $paras = array_slice($sec['text'], 0, $n_paras);
        if ($paras) $out .= '<div class="text">' . implode('', array_map(fn($p) => '<p>' . $p . '</p>', $paras)) . '</div>';
        if ($ups) { $out .= '<div><span class="label">The month\'s updates</span><ul class="updates">'; foreach ($ups as [$d, $t]) $out .= '<li><span class="d dir ' . $d . '">' . ED_Calc::ARROW[$d] . '</span>' . $t . '</li>'; $out .= '</ul></div>'; }
        if ($figs) $out .= '<div><span class="label">The figures</span>' . ed_reports_fig_table($figs, $S) . '</div>';
        $codes = array_values(array_filter($sec['charts'], fn($c) => isset(ED_Render::charts()[$c])));
        if ($codes) $out .= '<div><span class="label">Charts</span><div class="charts" data-charts="' . esc_attr(implode(',', $codes)) . '"></div></div>';
        if ($sec['risks']) {
            $out .= '<div><span class="label">Risks ahead</span><div class="risks">';
            foreach ($sec['risks'] as $r) $out .= '<div class="risk ' . $r['level'] . '"><strong>' . $r['title'] . '<span class="when">' . $r['horizon'] . '</span></strong>' . $r['text'] . ($r['watch'] !== '' ? '<div class="watch"><b>Watch</b> ' . $r['watch'] . '</div>' : '') . '</div>';
            $out .= '</div></div>';
        }
        if ($sec['gap'] !== '') $out .= '<p class="gap"><b>To add:</b> ' . $sec['gap'] . '</p>';
        $out .= '</section>';
    }
    $out .= '</div>';

    // ---- what changed and the explorer
    $feed = [];
    $cutoff = ED_Calc::add_months($this_month, -2);
    foreach ($S as $code => $ser) {
        if (in_array($code, ['FX_REAL'], true) || empty($meta[$code]) || !preg_match('/month|week|daily/i', $meta[$code]['frequency'] ?? '')) continue;
        [$v, $m] = ed_reports_last_actual($S, $code, $this_month);
        if ($v === null || $m < $cutoff) continue;
        $feed[] = [$m, $code, $v];
    }
    usort($feed, fn($a, $b) => strcmp($b[0], $a[0]) ?: strcmp($a[1], $b[1]));
    $out .= '<section class="block" id="changed" data-short="What changed"><h2>What changed</h2><p class="lede">The series that moved in the last two months, newest first, with the change on the month.</p><div class="two">';
    $out .= '<ul class="feed">';
    foreach ($feed as [$m, $code, $v]) {
        $tr = ED_Calc::series_trend($S, $code);
        $rate = in_array($code, ED_Calc::RATE_CODES, true);
        $out .= '<li><span class="dt">' . esc_html(ED_Calc::month_label($m)) . '</span><span>' . esc_html($meta[$code]['name'] ?? $code) . '<br><span class="sect">' . esc_html(rtrim($meta[$code]['section_code'] ?? substr($code, 0, 3), '_') . ' · ' . ($meta[$code]['unit'] ?? '')) . '</span></span><span class="v num">' . ED_Calc::fmt($v, $rate ? 2 : (abs($v) >= 100 ? 0 : 2)) . '</span><span class="chg num">' . ($tr ? ed_reports_dir_span($tr['dir'], $tr['change']) : '') . '</span></li>';
    }
    if (!$feed) $out .= '<li><span class="dt"></span><span>No release in the last two months.</span></li>';
    $out .= '</ul>';
    $out .= '<div class="explore" id="ed-explore"><div class="controls"><select class="ind" aria-label="Indicator"></select><span class="range"><button type="button" data-m="12">1 y</button><button type="button" data-m="36" class="on">3 y</button><button type="button" data-m="0">All</button></span><label><input type="checkbox" class="cmp"> the other countries</label></div><div class="explore-chart"></div></div>';
    $out .= '</div></section>';

    // ---- benchmark, scores, facts, sources
    $out .= do_shortcode('[ed_benchmark lede="The countries covered, ordered by cost pressure; click a column to sort. {name} is highlighted."]');
    $out .= do_shortcode('[ed_scores]');
    if ($R['facts']) {
        $half = intdiv(count($R['facts']) + 1, 2);
        $out .= '<section class="appendix" id="facts" data-short="Standing facts"><details class="plain"><summary>Standing facts</summary><div class="facts">';
        foreach ([array_slice($R['facts'], 0, $half), array_slice($R['facts'], $half)] as $col) { $out .= '<dl>'; foreach ($col as [$dt, $dd]) $out .= '<div><dt>' . esc_html($dt) . '</dt><dd>' . $dd . '</dd></div>'; $out .= '</dl>'; }
        $out .= '</div></details></section>';
    }
    if ($R['sources']) $out .= '<section class="appendix" id="sources"><details class="plain"><summary>Sources</summary><ul class="sources">' . implode('', array_map(fn($x) => '<li>' . $x . '</li>', $R['sources'])) . '</ul></details></section>';
    return $out;
}

/** The comparison series of the other scored countries, for the explorer (cached with each country's data). */
function ed_reports_compare_block(array $D): array {
    $codes = ['INF_CPI', 'FX_REAL', 'FIN_POLICY', 'TRD_APP_EXP', 'POL_UNREST'];
    $out = [];
    foreach ($D['bench'] ?? [] as $row) {
        $iso = $row['iso'];
        $d = $iso === ($D['country'] ?? '') ? $D : ED_Api::page_data($iso);
        if (!$d) continue;
        $entry = ['name' => $d['name'] ?? $iso];
        foreach ($codes as $c) { if ($c === 'FX_REAL') { if (!empty($d['fx_real'])) $entry[$c] = $d['fx_real']; } elseif (!empty($d['series'][$c])) $entry[$c] = $d['series'][$c]; }
        $out[$iso] = $entry;
    }
    return $out;
}
