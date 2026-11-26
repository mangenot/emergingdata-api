<?php
/**
 * The home page blocks, filled from the API for the countries listed in the setting "Home page countries":
 * [ed_home_hero]...[/ed_home_hero] the opening band with the text written in the page and the chart of the five
 * currencies in real terms; [ed_home_strip] the figures of the morning (currency and its moves, inflation, wage,
 * apparel exports, scores); [ed_home_changed] the latest releases across the countries; and the report cards of
 * [ed_reports_index] (site.php) take their sparkline and scores from here.
 */
if (!defined('ABSPATH')) exit;

const ED_HOME_COLORS = ['HND' => 'var(--c1)', 'BGD' => 'var(--c2)', 'KEN' => 'var(--c3)', 'KHM' => 'var(--c4)', 'PAK' => 'var(--c5)'];
const ED_HOME_SKIP = '/PREM|PARALLEL|FX_REAL/';

function ed_home_countries(): array {
    $list = preg_split('/[\s,]+/', strtoupper((string) ED_Api::setting('home_countries')), -1, PREG_SPLIT_NO_EMPTY);
    return $list ?: ['BGD', 'KHM', 'HND', 'KEN', 'PAK'];
}

function ed_home_color(string $iso): string {
    static $extra = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)'];
    if (isset(ED_HOME_COLORS[$iso])) return ED_HOME_COLORS[$iso];
    $i = array_search($iso, ed_home_countries(), true);
    return $extra[($i === false ? crc32($iso) : $i) % 5];
}

/** The page data of every home page country, in the order of the setting (countries without data are left out). */
function ed_home_data(): array {
    static $data = null;
    if ($data !== null) return $data;
    $data = [];
    foreach (ed_home_countries() as $iso) {
        $d = ED_Api::page_data($iso);
        if ($d) $data[$iso] = $d;
    }
    return $data;
}

function ed_home_this_month(): string {
    return current_time('Y-m');
}

/** Today's date line: the fetch date of the freshest country data. */
function ed_home_generated(): string {
    $latest = '';
    foreach (ed_home_data() as $d) if (($d['generated'] ?? '') > $latest) $latest = $d['generated'];
    return $latest ? substr($latest, 0, 10) : current_time('Y-m-d');
}

function ed_home_pill($v): string {
    if ($v === null) return '&ndash;';
    $n = min(5, max(1, (int) round((float) $v)));
    return '<span class="pill p' . $n . '">' . ED_Calc::fmt($v, 1) . '</span>';
}

function ed_home_trend_arrow(?string $t): string {
    return '<span class="tarrow">' . ($t === 'up' ? '&uarr;' : ($t === 'down' ? '&darr;' : '&rarr;')) . '</span>';
}

function ed_home_block_head(string $title, string $aside, string $lede = ''): string {
    return '<div class="block-head"><h2>' . esc_html($title) . '</h2>' . ($aside !== '' ? '<span class="when">' . $aside . '</span>' : '') . '</div>'
         . ($lede !== '' ? '<p class="lede">' . $lede . '</p>' : '');
}

// ---------------------------------------------------------------- the opening band
add_shortcode('ed_home_hero', function ($atts, $content = '') {
    $data = ed_home_data();
    $series = [];
    foreach ($data as $iso => $d) {
        if (!empty($d['fx_real']['values'])) $series[] = ['iso' => $iso, 'name' => $d['name'], 'color' => ed_home_color($iso), 'fx_real' => ['start' => $d['fx_real']['start'], 'values' => $d['fx_real']['values']]];
    }
    $json = wp_json_encode(['series' => $series, 'today' => ed_home_generated()], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    wp_enqueue_script('ed-home', ED_REPORTS_URL . 'assets/home.js', [], ED_REPORTS_VERSION, true);
    $note = 'Figures of ' . ED_Calc::date_label(ed_home_generated()) . ', refreshed every morning from the database.';
    $edition = trim((string) ED_Api::setting('edition'));
    if ($edition) $note .= ' Reports of the ' . esc_html(preg_replace('/\s*edition$/i', '', $edition)) . ' edition.';
    return '<div class="ed-hero-band"><div class="ed-hero-in"><div class="ed-hero-text">' . do_shortcode($content) . '<p class="note">' . $note . '</p></div>'
         . '<div class="card ed-hero-chart" id="ed-home-chart"></div></div>'
         . '<script type="application/json" id="ed-home-data">' . str_replace('</', '<\/', $json) . '</script></div>';
});

// ---------------------------------------------------------------- the figures of the morning
add_shortcode('ed_home_strip', function ($atts) {
    $a = shortcode_atts(['title' => 'The five countries this morning', 'lede' => 'The currency and what it did over twelve months, in nominal terms and in real terms (a positive real move means local costs became dearer in dollars), the latest inflation, the garment minimum wage in dollars, apparel exports over twelve months, and the two scores of the month.',
                         'foot' => 'Scores: cost pressure and disruption risk, 1 lowest to 5 highest, frozen on the first day of the month. Apparel exports: US imports from OTEXA for Kenya and Honduras, national customs data for the three others.'], $atts, 'ed_home_strip');
    $data = ed_home_data();
    if (!$data) return '';
    $bench = [];
    foreach ($data as $d) foreach ($d['bench'] ?? [] as $b) $bench[$b['iso']] = $b;
    $rows = '';
    foreach ($data as $iso => $d) {
        $f = $d['currency_figures'] ?? [];
        $sc = $d['scores'] ?? [];
        $b = $bench[$iso] ?? [];
        $dollar = (bool) preg_match('/dollari/i', (string) ($d['fx_regime'] ?? ''));
        $url = ed_home_report_url($iso);
        $name = '<a href="' . esc_url($url) . '">' . esc_html($d['name']) . '</a>';
        if (!$dollar && isset($f['dep12'])) {
            $dir = ED_Calc::direction($f['dep12'], false, 0.5);
            $nom = '<span class="dir ' . $dir . '">' . ED_Calc::ARROW[$dir] . '</span> ' . ED_Calc::signed($f['dep12'], 1, '%') . '<small>' . ($f['dep12'] >= 0 ? 'weaker' : 'stronger') . '</small>';
        } else $nom = '&ndash;';
        $real = !$dollar && isset($f['real_move']) ? '<span class="v">' . ED_Calc::signed($f['real_move'], 1, '%') . '</span><small>' . ($f['real_move'] >= 0 ? 'dearer in dollars' : 'cheaper in dollars') . '</small>' : '&ndash;';
        $wage = $f['wage'] ?? null;
        if (isset($b['appChg'])) {
            $dir = ED_Calc::direction($b['appChg'], false);
            $app = '<span class="dir ' . $dir . '">' . ED_Calc::ARROW[$dir] . '</span> ' . ED_Calc::signed($b['appChg'], 1, '%') . '<small>USD ' . ED_Calc::fmt($b['app'] ?? null, 0) . ' m, ' . esc_html($b['appDate'] ?? '') . '</small>';
        } else $app = '&ndash;';
        $rows .= '<tr><td class="c"><i style="background:' . ed_home_color($iso) . '"></i>' . $name . '</td>'
              . '<td><span class="v num">' . ($dollar ? 'USD' : ED_Calc::fmt($f['now'] ?? null, 2)) . '</span><small>' . ($dollar ? 'dollarised' : esc_html(($f['code'] ?? $d['currency']) . ', ' . ED_Calc::month_label($f['when'] ?? null))) . '</small></td>'
              . '<td>' . $nom . '</td><td>' . $real . '</td>'
              . '<td><span class="v num">' . (isset($f['cpi']) ? ED_Calc::fmt($f['cpi'], 1) . '%' : '&ndash;') . '</span><small>' . esc_html($b['cpiDate'] ?? '') . '</small></td>'
              . '<td><span class="v num">' . ($wage && isset($wage['now']) ? ED_Calc::fmt($wage['now'], 0) : '&ndash;') . '</span><small>' . ($wage && isset($wage['chg']) ? ED_Calc::signed($wage['chg'], 1, '%') . ' on a year earlier' : esc_html($b['wageLocal'] ?? '')) . '</small></td>'
              . '<td>' . $app . '</td>'
              . '<td>' . ed_home_pill($sc['cost_pressure'] ?? null) . ' ' . ed_home_trend_arrow($sc['cost_trend'] ?? null) . '</td>'
              . '<td>' . ed_home_pill($sc['disruption_risk'] ?? null) . ' ' . ed_home_trend_arrow($sc['risk_trend'] ?? null) . '</td></tr>';
    }
    $out = '<section class="ed-block ed-strip-block">' . ed_home_block_head($a['title'], '<span class="num">' . ED_Calc::date_label(ed_home_generated()) . '</span>', esc_html($a['lede']));
    $out .= '<div class="scroll"><table class="ed-strip"><thead><tr><th>Country</th><th>Currency<br>per USD</th><th>12 months<br>nominal</th><th>12 months<br>real</th><th>Inflation</th><th>Garment wage<br>USD a month</th><th>Apparel exports<br>12 months</th><th>Cost</th><th>Risk</th></tr></thead><tbody>' . $rows . '</tbody></table></div>';
    if ($a['foot'] !== '') $out .= '<p class="foot">' . esc_html($a['foot']) . '</p>';
    return $out . '</section>';
});

/** The address of a country's report (its latest post), or the reports index. */
function ed_home_report_url(string $iso): string {
    static $map = null;
    if ($map === null) {
        $map = [];
        foreach (function_exists('ed_site_latest_reports') ? ed_site_latest_reports() : [] as $p) $map[strtoupper((string) get_post_meta($p->ID, '_ed_iso', true))] = get_permalink($p);
    }
    return $map[$iso] ?? get_post_type_archive_link('country_report');
}

// ---------------------------------------------------------------- what changed
function ed_home_section_word(string $code): string {
    static $map = ['EXT_RES' => 'finance', 'INF_CPI' => 'finance', 'FIN_POLICY' => 'finance', 'EXT_REMIT' => 'finance', 'FIN_CREDIT' => 'finance', 'FIN_NPL' => 'finance', 'FX_USD' => 'currency', 'TRD_EXP' => 'trade', 'TRD_IMP' => 'trade', 'TRD_APP_EXP' => 'trade', 'TRD_BAL' => 'trade', 'POL_UNREST' => 'politics', 'POL_UNREST_SHARE' => 'politics'];
    return $map[$code] ?? strtolower(substr($code, 0, 3));
}

add_shortcode('ed_home_changed', function ($atts) {
    $a = shortcode_atts(['title' => 'What changed', 'aside' => 'the latest releases across the five countries, newest first', 'items' => 14], $atts, 'ed_home_changed');
    $data = ed_home_data();
    if (!$data) return '';
    $this_month = ed_home_this_month();
    $cutoff = ED_Calc::add_months($this_month, -2);
    $feed = [];
    foreach ($data as $iso => $d) {
        $S = $d['series'] ?? []; $meta = $d['indicators'] ?? [];
        foreach ($S as $code => $s) {
            if (empty($meta[$code]) || !preg_match('/month|week|daily/i', $meta[$code]['frequency'] ?? '') || preg_match(ED_HOME_SKIP, $code)) continue;
            [$v, $m] = ed_reports_last_actual($S, $code, $this_month);
            if ($v === null || $m < $cutoff) continue;
            $feed[] = ['iso' => $iso, 'name' => $d['name'], 'code' => $code, 'label' => $meta[$code]['name'] ?? $code, 'unit' => $meta[$code]['unit'] ?? '', 'v' => $v, 'm' => $m, 'tr' => ED_Calc::series_trend($S, $code)];
        }
    }
    usort($feed, fn($x, $y) => strcmp($y['m'], $x['m']) ?: strcmp($x['iso'], $y['iso']) ?: strcmp($x['code'], $y['code']));
    $feed = array_slice($feed, 0, max(2, (int) $a['items']));
    $li = function ($x) {
        $pct = trim($x['unit']) === '%';
        $rate = in_array($x['code'], ED_Calc::RATE_CODES, true);
        return '<li><span class="dt">' . esc_html(ED_Calc::month_label($x['m'])) . '</span><span><span class="who" style="color:' . ed_home_color($x['iso']) . '">' . esc_html($x['name'] . ' · ' . ed_home_section_word($x['code'])) . '</span>' . esc_html($x['label']) . ($pct ? '' : ' <span class="unit">' . esc_html($x['unit']) . '</span>') . '</span>'
             . '<span class="v num">' . ED_Calc::fmt($x['v'], $rate ? 2 : (abs($x['v']) >= 100 ? 0 : 2)) . ($pct ? '%' : '') . '</span>'
             . '<span class="chg num">' . ($x['tr'] ? ed_reports_dir_span($x['tr']['dir'], preg_replace('/ on the month$/', '', $x['tr']['change'])) : '') . '</span></li>';
    };
    $half = (int) ceil(count($feed) / 2);
    $out = '<section class="ed-block ed-changed">' . ed_home_block_head($a['title'], esc_html($a['aside']));
    $out .= '<div class="two"><ul class="feed">' . implode('', array_map($li, array_slice($feed, 0, $half))) . '</ul><ul class="feed">' . implode('', array_map($li, array_slice($feed, $half))) . '</ul></div></section>';
    return $out;
});

// ---------------------------------------------------------------- the cards' extras (used by ed_site_reports_index)
/** A sparkline of the last 24 points of a monthly series, in the country's colour. */
function ed_home_spark(array $S, string $code, string $color): string {
    $s = $S[$code] ?? null;
    if (!$s || empty($s['values'])) return '';
    $pts = [];
    foreach ($s['values'] as $i => $v) if ($v !== null) $pts[] = [$i, (float) $v];
    $pts = array_slice($pts, -24);
    if (count($pts) < 2) return '';
    $vs = array_column($pts, 1); $min = min($vs); $max = max($vs);
    $i0 = $pts[0][0]; $i1 = end($pts)[0]; $W = 120; $H = 32;
    $X = fn($i) => 2 + ($i - $i0) / max(1, $i1 - $i0) * ($W - 10);
    $Y = fn($v) => $max == $min ? $H / 2 : 3 + ($max - $v) / ($max - $min) * ($H - 8);
    $d = '';
    foreach ($pts as $k => [$i, $v]) $d .= ($k ? 'L' : 'M') . number_format($X($i), 1, '.', '') . ' ' . number_format($Y($v), 1, '.', '');
    [$ei, $ev] = end($pts);
    return '<svg class="spark" viewBox="0 0 ' . $W . ' ' . $H . '" preserveAspectRatio="none" aria-hidden="true"><path d="' . $d . '" fill="none" stroke="' . $color . '" stroke-width="1.6"/><circle cx="' . number_format($X($ei), 1, '.', '') . '" cy="' . number_format($Y($ev), 1, '.', '') . '" r="2.6" fill="' . $color . '"/></svg>';
}

/** The sparkline line and the scores line of a country's card, or '' without data. */
function ed_home_card_extras(string $iso): string {
    $d = ed_home_data()[$iso] ?? ED_Api::page_data($iso);
    if (!$d) return '';
    $S = $d['series'] ?? []; $out = '';
    [$v, $m] = ed_reports_last_actual($S, 'TRD_APP_EXP', ed_home_this_month());
    if ($v !== null) {
        $tr = ED_Calc::series_trend($S, 'TRD_APP_EXP');
        $big = abs($v) >= 1000;
        $out .= '<div class="sp"><span class="k">Apparel exports, monthly<b class="num">' . ED_Calc::fmt($big ? $v / 1000 : $v, $big ? 2 : 0) . ' ' . ($big ? 'bn' : 'm') . ' USD</b>' . esc_html(ED_Calc::month_label($m)) . ($tr ? ', ' . ed_reports_dir_span($tr['dir'], $tr['change']) : '') . '</span>' . ed_home_spark($S, 'TRD_APP_EXP', ed_home_color($iso)) . '</div>';
    }
    $sc = $d['scores'] ?? null;
    if ($sc && isset($sc['cost_pressure'])) {
        $out .= '<p class="sc">Cost pressure <b>' . ED_Calc::fmt($sc['cost_pressure'], 1) . ' ' . ed_home_trend_arrow($sc['cost_trend'] ?? null) . '</b> &nbsp; Disruption risk <b>' . ED_Calc::fmt($sc['disruption_risk'] ?? null, 1) . ' ' . ed_home_trend_arrow($sc['risk_trend'] ?? null) . '</b></p>';
    }
    return $out;
}
