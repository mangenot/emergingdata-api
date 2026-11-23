<?php
/**
 * The shortcodes of a country report. The text parts wrap what the editor writes; the computed parts (tiles with
 * their trends, the currency block, the trade tiles, the charts, the benchmark table, the scores) are filled from
 * the API data of the report's country.
 *
 *   [ed_overview date="21 November 2026"][ed_standfirst]...[/ed_standfirst] <h3>..</h3><p>..</p> [ed_byline]...[/ed_byline][/ed_overview]
 *   [ed_global]                                   the block shared by every report, from the settings
 *   [ed_section key="FIN"] ... [/ed_section]      a numbered section; keys FIN, EXT, POL, LOG, ENE
 *     [ed_lead]...[/ed_lead]                      the conclusion in bold
 *     [ed_currency then="Public finances and the banks" rate="26.91" rate_note="HNL per USD, 20 Nov 2026"]text[/ed_currency]
 *     [ed_text]one sentence per line; a blank line starts a new paragraph[/ed_text]
 *     [ed_updates][ed_update dir="up"]...[/ed_update] ...[/ed_updates]      in the EXT section the currency line is added
 *     [ed_figs][ed_fig label="Reserves" value="USD 9.1 bn" code="EXT_RES"]note[/ed_fig] ...[/ed_figs]
 *       value="auto" decimals="1" scale="0.001" takes the latest value of the code; trend="up|+3% on the week|up|down|Oct 2026" sets one by hand
 *     [ed_charts][ed_chart code="EXT_RES" title="Reserves" unit="USD million" decimals="0" series="EXT_RES:Reserves"] ...[/ed_charts]
 *     [ed_risks][ed_risk level="high" title="..." horizon="..."]text[ed_watch]...[/ed_watch][/ed_risk] ...[/ed_risks]
 *     [ed_gap]...[/ed_gap]
 *   [ed_facts][ed_fact label="Currency"]...[/ed_fact] ...[/ed_facts]
 *   [ed_benchmark]  [ed_scores]  [ed_method][ed_sources]one source per line[/ed_sources][/ed_method]
 */
if (!defined('ABSPATH')) exit;

// markers left outside a section are removed from the final content
add_filter('the_content', function ($c) { return is_singular('country_report') ? ED_Render::fold($c, false) : $c; }, 12);

/** The raw inner text of every [tag]...[/tag] in a content string, in order (used for lists of items). */
function ed_sc_items(string $content, string $tag): array {
    $out = [];
    if (preg_match_all('/\[' . $tag . '((?:\s[^\]]*)?)\](.*?)\[\/' . $tag . '\]/s', $content, $m, PREG_SET_ORDER)) {
        foreach ($m as $x) $out[] = [shortcode_parse_atts(trim($x[1])) ?: [], $x[2]];
    }
    return $out;
}

/** The content of one nested [tag]...[/tag], removed from the string (by reference). */
function ed_sc_take(string &$content, string $tag): string {
    if (preg_match('/\[' . $tag . '\](.*?)\[\/' . $tag . '\]/s', $content, $m)) {
        $content = str_replace($m[0], '', $content);
        return trim($m[1]);
    }
    return '';
}

/** The report's data is loaded once per page before any shortcode runs. */
function ed_sc_begin(): void {
    $id = get_the_ID();
    if ($id) ED_Render::begin((int) $id);
    ED_Render::used();
}

function ed_sc_section_key(): string {
    return $GLOBALS['ed_current_section'] ?? '';
}

// ---------------------------------------------------------------- overview and global block
add_shortcode('ed_overview', function ($atts, $content = '') {
    ed_sc_begin();
    $a = shortcode_atts(['date' => ''], $atts);
    $content = (string) $content;
    $standfirst = ed_sc_take($content, 'ed_standfirst');
    $byline = ed_sc_take($content, 'ed_byline');
    $body = do_shortcode(trim($content));
    return '<section class="report overview" id="overview" data-short="Overview"><h2>Overview <span class="date num">' . esc_html($a['date']) . '</span></h2>'
         . ($standfirst ? '<p class="standfirst">' . $standfirst . '</p>' : '')
         . '<div class="ovbody">' . $body . '</div>'
         . ($byline ? '<p class="small">' . $byline . '</p>' : '') . '</section>';
});

add_shortcode('ed_global', function ($atts, $content = '') {
    ed_sc_begin();
    $s = ED_Api::settings();
    $items = [];
    $src = trim((string) $content) !== '' ? (string) $content : (string) $s['global_items'];
    foreach (preg_split('/\r?\n/', $src) as $line) {
        $line = trim($line);
        if ($line === '' || strpos($line, '|') === false) continue;
        [$label, $text] = array_map('trim', explode('|', $line, 2));
        if ($text === '') continue;
        $items[] = '<div><span class="label">' . esc_html($label) . '</span>' . $text . '</div>';
    }
    if (!$items) return '';
    return '<section class="report" id="global" data-short="Global context"><h2>' . esc_html($s['global_title']) . '</h2>'
         . ($s['global_intro'] ? '<p class="small">' . esc_html($s['global_intro']) . '</p>' : '')
         . '<div class="context">' . implode('', $items) . '</div></section>';
});

// ---------------------------------------------------------------- sections
add_shortcode('ed_section', function ($atts, $content = '') {
    ed_sc_begin();
    $a = shortcode_atts(['key' => '', 'title' => '', 'short' => '', 'fold' => ''], $atts);
    $key = strtoupper($a['key']);
    $def = ED_Render::SECTIONS[$key] ?? [$a['title'] ?: 'Section', $a['short'] ?: ($a['title'] ?: 'Section')];
    $title = $a['title'] ?: $def[0];
    $short = $a['short'] ?: $def[1];
    $n = ED_Render::next_section();
    $GLOBALS['ed_current_section'] = $key;
    $body = do_shortcode(trim((string) $content));
    $GLOBALS['ed_current_section'] = '';
    $fold = $a['fold'] !== '' ? $a['fold'] === '1' : (bool) ED_Api::setting('fold');
    $body = ED_Render::fold($body, $fold);
    return '<section class="chapter" id="c' . $n . '" data-key="' . esc_attr($key) . '" data-short="' . esc_attr($n . ' ' . $short) . '"><h2><span class="n">' . $n . '</span>' . esc_html($title) . '</h2>' . $body . '</section>';
});

add_shortcode('ed_lead', function ($atts, $content = '') {
    return '<p class="concl">' . trim((string) $content) . '</p>';
});

add_shortcode('ed_text', function ($atts, $content = '') {
    $paras = preg_split('/\n\s*\n/', trim((string) $content));
    $out = '';
    foreach ($paras as $p) {
        $p = trim($p);
        if ($p !== '') $out .= '<p class="text">' . ED_Render::lines($p) . '</p>';
    }
    return $out;
});

add_shortcode('ed_currency', function ($atts, $content = '') {
    ed_sc_begin();
    $a = shortcode_atts(['then' => 'Public finances and the banks', 'rate' => '', 'rate_note' => '', 'title' => 'The currency'], $atts);
    $d = ED_Render::data();
    $F = $d['currency_figures'] ?? null;
    $out = '<h3 class="block">' . esc_html($a['title']) . '</h3>';
    $text = trim((string) $content);
    if ($text !== '') $out .= '<p class="text">' . ED_Render::lines($text) . '</p>';
    if ($F) {
        $figs = ED_Calc::currency_tiles($F, $a['rate'], $a['rate_note']);
        $out .= '<div class="figs">' . implode('', array_map([ED_Render::class, 'fig_html'], $figs)) . '</div>';
        $out .= '<div class="charts" data-charts="FX_USD,FX_REAL"></div>';
    } else {
        $out .= '<p class="small">The currency figures are not available at the moment.</p>';
    }
    if ($a['then'] !== '') $out .= '<h3 class="block">' . esc_html($a['then']) . '</h3>';
    return $out;
});

add_shortcode('ed_updates', function ($atts, $content = '') {
    ed_sc_begin();
    $a = shortcode_atts(['trade' => ''], $atts);
    $ups = [];
    $trade = $a['trade'] !== '' ? $a['trade'] === '1' : ed_sc_section_key() === 'EXT';
    if ($trade) {
        $F = ED_Render::data()['currency_figures'] ?? null;
        if ($F) { [, $upd] = ED_Calc::trade_tiles($F); if ($upd) $ups[] = $upd; }
    }
    foreach (ed_sc_items((string) $content, 'ed_update') as [$ia, $text]) {
        $dir = strtolower($ia['dir'] ?? 'flat');
        if (!isset(ED_Calc::ARROW[$dir])) $dir = 'flat';
        $ups[] = [$dir, trim($text)];
    }
    $html = ED_Render::updates_html($ups);
    return $html === '' ? '' : '<!--ed:updates:' . count($ups) . '-->' . $html . '<!--/ed:updates-->';
});
add_shortcode('ed_update', fn() => '');

add_shortcode('ed_figs', function ($atts, $content = '') {
    ed_sc_begin();
    $a = shortcode_atts(['trade' => ''], $atts);
    $out = '';
    $trade = $a['trade'] !== '' ? $a['trade'] === '1' : ed_sc_section_key() === 'EXT';
    if ($trade) {
        $F = ED_Render::data()['currency_figures'] ?? null;
        if ($F) { [$figs] = ED_Calc::trade_tiles($F); $out .= implode('', array_map([ED_Render::class, 'fig_html'], $figs)); }
    }
    $out .= do_shortcode(trim((string) $content));
    $n = substr_count($out, '<div class="fig">');
    return '<!--ed:figs:' . $n . '--><div class="figs">' . $out . '</div><!--/ed:figs-->';
});

add_shortcode('ed_fig', function ($atts, $content = '') {
    ed_sc_begin();
    $a = shortcode_atts(['label' => '', 'value' => '', 'unit' => '', 'code' => '', 'trend' => '', 'decimals' => '0', 'scale' => ''], $atts);
    $note = trim((string) $content);
    $value = $a['value'];
    if ($value === 'auto' && $a['code'] !== '') {
        [$value, $month] = ED_Render::auto_value($a['code'], (int) $a['decimals'], $a['scale'] !== '' ? (float) $a['scale'] : null);
        if ($note === '') $note = esc_html($month);
    }
    $trend = null;
    if ($a['trend'] !== '') {
        $p = array_map('trim', explode('|', $a['trend']));
        $trend = ['dir' => $p[0] ?? 'flat', 'change' => $p[1] ?? '', 'short' => $p[2] ?? 'flat', 'long' => $p[3] ?? 'flat'];
        if (!empty($p[4])) $trend['when'] = $p[4];
        foreach (['dir', 'short', 'long'] as $k) if (!isset(ED_Calc::ARROW[$trend[$k]])) $trend[$k] = 'flat';
    }
    return ED_Render::fig_html(['label' => $a['label'], 'value' => $value, 'unit' => $a['unit'], 'note' => $note, 'code' => $a['code'], 'trend' => $trend]);
});

add_shortcode('ed_charts', function ($atts, $content = '') {
    ed_sc_begin();
    $a = shortcode_atts(['codes' => ''], $atts);
    $codes = [];
    foreach (ed_sc_items((string) $content, 'ed_chart') as [$ia]) if (!empty($ia['code'])) $codes[] = strtoupper($ia['code']);
    if (preg_match_all('/\[ed_chart\s([^\]]*)\]/', (string) $content, $m)) {
        foreach ($m[1] as $raw) { $ia = shortcode_parse_atts(trim($raw)); if (!empty($ia['code'])) $codes[] = strtoupper($ia['code']); }
    }
    do_shortcode((string) $content);      // registers the chart specifications
    if ($a['codes'] !== '') $codes = array_merge(array_map('trim', explode(',', strtoupper($a['codes']))), $codes);
    $codes = array_values(array_unique(array_filter($codes)));
    if (!$codes) return '';
    return '<div class="charts" data-charts="' . esc_attr(implode(',', $codes)) . '"></div>';
});

add_shortcode('ed_chart', function ($atts, $content = '') {
    ed_sc_begin();
    $a = shortcode_atts(['code' => '', 'title' => '', 'unit' => '', 'decimals' => '0', 'tick' => '', 'zero' => '', 'step' => '', 'series' => ''], $atts);
    if ($a['code'] === '') return '';
    $code = strtoupper($a['code']);
    $series = [];
    foreach (array_filter(array_map('trim', explode(';', $a['series'] ?: $code . ':' . ($a['title'] ?: $code)))) as $item) {
        $p = array_map('trim', explode(':', $item));
        $s = ['name' => $p[1] ?? $p[0], 'code' => strtoupper($p[0])];
        if (isset($p[2]) && $p[2] !== '') $s['scale'] = (float) $p[2];
        $series[] = $s;
    }
    $spec = ['title' => $a['title'] ?: $code, 'unit' => $a['unit'], 'decimals' => (int) $a['decimals'], 'series' => $series];
    if ($a['tick'] !== '') $spec['tickDecimals'] = (int) $a['tick'];
    if ($a['zero'] === '1') $spec['zero'] = true;
    if ($a['step'] === '1') $spec['step'] = true;
    ED_Render::add_chart($code, $spec);
    return '';
});

add_shortcode('ed_risks', function ($atts, $content = '') {
    $items = ed_sc_items((string) $content, 'ed_risk');
    if (!$items) return '';
    $out = '<div class="risks"><h3>Risks ahead</h3><div class="riskgrid">';
    foreach ($items as [$ia, $text]) {
        $lvl = strtolower($ia['level'] ?? 'medium');
        if (!in_array($lvl, ['high', 'medium', 'low'], true)) $lvl = 'medium';
        $watch = ed_sc_take($text, 'ed_watch');
        $out .= '<div class="risk ' . $lvl . '"><div class="rh"><span class="pill ' . $lvl . '">' . ucfirst($lvl) . '</span><strong>' . ($ia['title'] ?? '') . '</strong>'
              . '<span class="when">' . ($ia['horizon'] ?? '') . '</span></div><p>' . trim($text) . '</p>'
              . ($watch !== '' ? '<p class="watch"><span class="label">Watch</span>' . $watch . '</p>' : '') . '</div>';
    }
    return $out . '</div></div>';
});
add_shortcode('ed_risk', fn() => '');

add_shortcode('ed_gap', function ($atts, $content = '') {
    $t = trim((string) $content);
    return $t === '' ? '' : '<p class="gap"><strong>To add:</strong> ' . $t . '</p>';
});

// ---------------------------------------------------------------- appendices
add_shortcode('ed_facts', function ($atts, $content = '') {
    ed_sc_begin();
    $a = shortcode_atts(['lede' => 'Statuses that change by event rather than by month. Those marked "verify" are awaiting a check and are not yet used in the scores.'], $atts);
    $items = ed_sc_items((string) $content, 'ed_fact');
    if (!$items) return '';
    $half = intdiv(count($items) + 1, 2);
    $cols = [array_slice($items, 0, $half), array_slice($items, $half)];
    $out = '<section class="appendix" id="facts" data-short="Standing facts"><h2>Standing facts</h2><p class="lede">' . esc_html($a['lede']) . '</p><div class="facts">';
    foreach ($cols as $col) {
        $out .= '<dl>';
        foreach ($col as [$ia, $text]) $out .= '<div><dt>' . esc_html($ia['label'] ?? '') . '</dt><dd>' . trim($text) . '</dd></div>';
        $out .= '</dl>';
    }
    return $out . '</div></section>';
});
add_shortcode('ed_fact', fn() => '');

add_shortcode('ed_benchmark', function ($atts) {
    ed_sc_begin();
    $d = ED_Render::data();
    $n = count($d['bench'] ?? []);
    $a = shortcode_atts(['lede' => 'The ' . ($n ?: 'five') . ' countries covered, ordered by cost pressure. {name} is highlighted.', 'foot' => ''], $atts);
    $foot = $a['foot'] !== '' ? $a['foot'] : (string) ED_Api::setting('bench_foot');
    if (!$n) return '<section class="appendix" id="benchmark" data-short="Benchmark"><h2>Macro benchmark</h2><p class="small">The benchmark table is not available at the moment.</p></section>';
    return '<section class="appendix" id="benchmark" data-short="Benchmark"><h2>Macro benchmark</h2><p class="lede">' . esc_html(ED_Render::fill($a['lede'])) . '</p>'
         . '<div class="scroll"><table id="bench"></table></div><p class="foot">' . $foot . '</p></section>';
});

add_shortcode('ed_scores', function ($atts) {
    ed_sc_begin();
    $d = ED_Render::data();
    $sc = ED_Calc::scores_block($d['scores'] ?? null, ED_Render::covered());
    $a = shortcode_atts(['lede' => (string) ED_Api::setting('scores_lede')], $atts);
    if (!$sc) return '<section class="appendix" id="scores" data-short="Scores"><h2>Scores</h2><p class="small">The scores are not available at the moment.</p></section>';
    return '<section class="appendix" id="scores" data-short="Scores"><h2>Scores</h2><p class="lede">' . esc_html(ED_Render::fill($a['lede'])) . '</p>'
         . '<div class="comps" id="comps"></div><div class="scroll"><table class="scores" id="sectable"></table></div>'
         . ($sc['cov'] ? '<p class="foot">' . esc_html($sc['cov']) . '</p>' : '') . '</section>';
});

add_shortcode('ed_method', function ($atts, $content = '') {
    ed_sc_begin();
    $content = (string) $content;
    $sources = ed_sc_take($content, 'ed_sources');
    $method = [];
    $own = trim($content);
    $src = $own !== '' ? $own : (string) ED_Api::setting('method_items');
    foreach (preg_split('/\r?\n/', $src) as $line) if (trim($line) !== '') $method[] = '<li>' . trim($line) . '</li>';
    $srcs = [];
    foreach (preg_split('/\r?\n/', $sources) as $line) {
        $line = trim($line);
        if ($line === '') continue;
        $srcs[] = preg_match('/^<li/i', $line) ? $line : '<li>' . $line . '</li>';
    }
    return '<section class="appendix" id="method" data-short="Method"><h2>Method and sources</h2><div class="method">'
         . '<div><h3 class="label">Method</h3><ul>' . implode('', $method) . '</ul></div>'
         . ($srcs ? '<div><h3 class="label">Sources</h3><ul>' . implode('', $srcs) . '</ul></div>' : '')
         . '</div></section>';
});
add_shortcode('ed_sources', fn() => '');
add_shortcode('ed_standfirst', fn() => '');
add_shortcode('ed_byline', fn() => '');
add_shortcode('ed_watch', fn() => '');
