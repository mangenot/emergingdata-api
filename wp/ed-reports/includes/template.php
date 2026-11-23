<?php
/**
 * The report page: the plugin's single template for the post type (the theme's header and footer around a report
 * column), its stylesheet and script, the JSON block the script reads, and the access rule (Paid Memberships Pro
 * when it is active).
 */
if (!defined('ABSPATH')) exit;

// The two views of a report share its address: /reports/<slug>/ is the data view (or the report, by the setting),
// /reports/<slug>/report/ the printed report; ?view=report and ?view=data work as well.
add_action('init', function () {
    add_rewrite_rule('^reports/([^/]+)/report/?$', 'index.php?country_report=$matches[1]&ed_view=report', 'top');
    add_rewrite_rule('^reports/([^/]+)/data/?$', 'index.php?country_report=$matches[1]&ed_view=data', 'top');
    if (get_option('ed_reports_rules') !== ED_REPORTS_VERSION) { flush_rewrite_rules(); update_option('ed_reports_rules', ED_REPORTS_VERSION); }
}, 20);
add_filter('query_vars', function ($vars) { $vars[] = 'ed_view'; return $vars; });

add_filter('single_template', function ($template) {
    if (is_singular('country_report')) {
        $name = ed_reports_view() === 'data' ? 'single-country_report-data.php' : 'single-country_report.php';
        $own = locate_template($name);      // a copy in the theme wins
        return $own ?: ED_REPORTS_DIR . 'templates/' . $name;
    }
    return $template;
});

add_filter('archive_template', function ($template) {
    if (is_post_type_archive('country_report') || is_tax('country_tag')) {
        $own = locate_template('archive-country_report.php');
        return $own ?: ED_REPORTS_DIR . 'templates/archive-country_report.php';
    }
    return $template;
});

// GeneratePress: the report takes the full width, without sidebar.
add_filter('generate_sidebar_layout', function ($layout) {
    return is_singular('country_report') || is_post_type_archive('country_report') ? 'no-sidebar' : $layout;
});
add_filter('generate_show_title', function ($show) { return is_singular('country_report') ? false : $show; });

add_action('wp_enqueue_scripts', function () {
    if (!is_singular('country_report') && !is_post_type_archive('country_report') && !is_tax('country_tag')) return;
    wp_enqueue_style('ed-reports-fonts', 'https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,400;0,600;0,700;1,400&family=Source+Serif+4:opsz,wght@8..60,500;8..60,600&display=swap', [], null);
    wp_enqueue_style('ed-reports', ED_REPORTS_URL . 'assets/report.css', ['ed-reports-fonts'], ED_REPORTS_VERSION);
    if (is_singular('country_report')) {
        wp_enqueue_script('ed-reports', ED_REPORTS_URL . 'assets/report.js', [], ED_REPORTS_VERSION, true);
        if (ed_reports_view() === 'data') {
            wp_enqueue_style('ed-reports-data', ED_REPORTS_URL . 'assets/dataview.css', ['ed-reports'], ED_REPORTS_VERSION);
            wp_enqueue_script('ed-reports-data', ED_REPORTS_URL . 'assets/dataview.js', ['ed-reports'], ED_REPORTS_VERSION, true);
        }
    }
});

/** The JSON block the script reads, printed before the script in the footer, for readers with access only. */
add_action('wp_footer', function () {
    if (!is_singular('country_report') || !ED_Render::is_used()) return;
    if (!ed_reports_can_view(get_the_ID())) return;
    $block = ED_Render::data_block();
    if (ed_reports_view() === 'data' && ED_Render::data()) {
        $d = ED_Render::data();
        $block['NAME'] = $d['name'] ?? '';
        $block['CURRENCY'] = $d['currency'] ?? '';
        $block['COMPARE'] = ed_reports_compare_block($d);
    }
    $json = wp_json_encode($block, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    echo '<script type="application/json" id="ed-report-data">' . str_replace('</', '<\/', $json) . '</script>' . "\n";
}, 5);

/** Whether the current reader may see the body of the report: Paid Memberships Pro decides when it is active. */
function ed_reports_can_view(int $post_id): bool {
    if (current_user_can('edit_post', $post_id)) return true;
    if (function_exists('pmpro_has_membership_access')) {
        return (bool) pmpro_has_membership_access($post_id);
    }
    return true;
}

/** The masthead, title block and contents line of a report. */
function ed_reports_title_block(WP_Post $post): string {
    ED_Render::begin($post->ID);
    $s = ED_Api::settings();
    $view = ed_reports_view();
    $edition = get_post_meta($post->ID, '_ed_edition', true) ?: $s['edition'];
    $sub = get_post_meta($post->ID, '_ed_subtitle', true);
    $meta = ED_Render::fill((string) get_post_meta($post->ID, '_ed_meta', true));
    $switch = '<span class="switch">' . ($view === 'data' ? '<span class="on">Data view</span>' : '<a href="' . esc_url(ed_reports_view_url($post, 'data')) . '">Data view</a>')
            . ($view === 'report' ? '<span class="on">Report view</span>' : '<a href="' . esc_url(ed_reports_view_url($post, 'report')) . '">Report view</a>') . '</span>';
    $out = '<header class="mast"><div class="brand"><span class="wordmark">EmergingData</span><span>Country report</span></div>';
    $out .= '<div class="edition">' . $switch . esc_html($edition) . ($s['show_print'] && $view === 'report' ? ' <button type="button" class="print" onclick="window.print()">Print</button>' : '') . '</div></header>';
    $out .= '<section class="title"><h1>' . esc_html(get_the_title($post)) . '</h1>';
    if ($sub) $out .= '<p class="sub">' . esc_html($sub) . '</p>';
    if ($meta) $out .= '<p class="meta num">' . $meta . '</p>';
    $out .= '</section>';
    // the contents bar is a sibling of the title, not its child, so that it stays on screen down the whole report
    $out .= '<nav class="contents" aria-label="Contents" id="ed-contents" data-fold="' . (ED_Api::setting('fold') ? '1' : '0') . '"></nav>';
    return $out;
}

/** The footer line of a report. */
function ed_reports_footer_line(WP_Post $post): string {
    $text = ED_Render::fill((string) ED_Api::setting('footer'));
    return $text ? '<footer>' . esc_html($text) . '</footer>' : '';
}
