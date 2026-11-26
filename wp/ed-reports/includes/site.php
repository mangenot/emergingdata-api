<?php
/**
 * The site frame around the reports: the GeneratePress layout applied once (full width, no sidebar, menu to the
 * right of the site title, tagline shown, no footer widgets), the main menu created once, the footer line, the site
 * stylesheet on every page, the list of reports for the home page ([ed_reports_index]) and the reports index page.
 * Everything applied once is editable afterwards in the WordPress admin (Customizer, Appearance > Menus).
 */
if (!defined('ABSPATH')) exit;

const ED_SITE_FRAME = 1;     // raise to apply the layout and the menu again on the next load

// ---------------------------------------------------------------- applied once
add_action('init', function () {
    if ((int) get_option('ed_site_frame', 0) >= ED_SITE_FRAME) return;
    if (function_exists('generate_get_defaults')) {
        $settings = get_option('generate_settings', []);
        $settings = array_merge(is_array($settings) ? $settings : [], [
            'container_width'         => 1160,
            'content_layout_setting'  => 'one-container',
            'layout_setting'          => 'no-sidebar',
            'blog_layout_setting'     => 'no-sidebar',
            'single_layout_setting'   => 'no-sidebar',
            'header_layout_setting'   => 'fluid-header',
            'header_inner_width'      => 'contained',
            'header_alignment_setting' => 'left',
            'nav_layout_setting'      => 'fluid-nav',
            'nav_inner_width'         => 'contained',
            'nav_position_setting'    => 'nav-float-right',
            'nav_alignment_setting'   => 'right',
            'nav_search'              => 'disable',
            'nav_dropdown_type'       => 'hover',
            'footer_layout_setting'   => 'fluid-footer',
            'footer_inner_width'      => 'contained',
            'footer_widget_setting'   => '0',
            'back_to_top'             => '',
            'hide_title'              => false,
            'hide_tagline'            => false,
            'post_content'            => 'excerpt',
        ]);
        update_option('generate_settings', $settings);
        delete_option('generate_dynamic_css_output');     // the theme's cached stylesheet, rebuilt on the next load
    }
    ed_site_menu();
    update_option('ed_site_frame', ED_SITE_FRAME);
}, 30);

/** The main menu, created if the site has none of that name, and set as the primary menu if that location is free. */
function ed_site_menu(): void {
    $menu = wp_get_nav_menu_object('Main menu');
    $id = $menu ? (int) $menu->term_id : (int) wp_create_nav_menu('Main menu');
    if (!$id || is_wp_error($id)) return;
    if (!wp_get_nav_menu_items($id)) {
        $items = [
            ['Reports', home_url('/reports/'), ''],
            ['Methodology', home_url('/methodology/'), ''],
            ['Subscribe', home_url('/subscribe/'), 'menu-cta'],
            ['Log in', wp_login_url(), 'menu-login'],
        ];
        foreach ($items as $i => [$title, $url, $class]) {
            wp_update_nav_menu_item($id, 0, [
                'menu-item-title' => $title, 'menu-item-url' => $url, 'menu-item-type' => 'custom',
                'menu-item-status' => 'publish', 'menu-item-position' => $i + 1, 'menu-item-classes' => $class,
            ]);
        }
    }
    $locations = get_theme_mod('nav_menu_locations', []);
    if (empty($locations['primary'])) { $locations['primary'] = $id; set_theme_mod('nav_menu_locations', $locations); }
}

// The "Log in" item becomes "Log out" for a reader who is logged in (class menu-login on the item).
add_filter('wp_nav_menu_objects', function ($items) {
    $on_reports = is_singular('country_report') || is_post_type_archive('country_report') || is_tax('country_tag');
    foreach ($items as $item) {
        if (is_user_logged_in() && in_array('menu-login', (array) $item->classes, true)) { $item->title = 'Log out'; $item->url = wp_logout_url(home_url('/')); }
        // the Reports item is the current one on every report page, not only on the index
        if ($on_reports && untrailingslashit($item->url) === untrailingslashit(home_url('/reports/'))) $item->classes[] = 'current-menu-item';
    }
    return $items;
});

// The privacy page of WordPress, once a page with that slug exists.
add_action('admin_init', function () {
    $current = get_post((int) get_option('wp_page_for_privacy_policy'));
    if ($current && $current->post_status === 'publish') return;
    $page = get_page_by_path('privacy');
    if ($page && $page->post_status === 'publish') update_option('wp_page_for_privacy_policy', $page->ID);
});

// ---------------------------------------------------------------- every page
add_filter('body_class', function ($classes) { $classes[] = 'ed-site'; return $classes; });

add_action('wp_enqueue_scripts', function () {
    wp_enqueue_style('ed-reports-fonts', 'https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,400;0,600;0,700;1,400&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600&display=swap', [], null);
    wp_enqueue_style('ed-site', ED_REPORTS_URL . 'assets/site.css', ['ed-reports-fonts'], ED_REPORTS_VERSION);
}, 5);

// No page title on the home page: its content opens with its own heading.
add_filter('generate_show_title', function ($show) { return is_front_page() ? false : $show; });

// The footer line (Settings > ED Reports > Site footer), in place of the theme's copyright.
add_filter('generate_copyright', function ($copyright) {
    $text = trim((string) ED_Api::setting('site_footer'));
    if ($text === '') return $copyright;
    $text = str_replace(['{year}', '{home}'], [date('Y'), home_url('/')], $text);
    return '<span class="ed-foot">' . wp_kses_post($text) . '</span>';
}, 20);

// ---------------------------------------------------------------- the list of reports
/** The latest report of each country: published ones for readers, drafts as well for editors. */
function ed_site_latest_reports(): array {
    $posts = get_posts([
        'post_type' => 'country_report', 'posts_per_page' => 50, 'orderby' => 'date', 'order' => 'DESC',
        'post_status' => current_user_can('edit_posts') ? ['publish', 'draft', 'pending', 'future'] : 'publish',
    ]);
    $by = [];
    foreach ($posts as $p) {
        $iso = strtoupper((string) get_post_meta($p->ID, '_ed_iso', true)) ?: 'P' . $p->ID;
        if (!isset($by[$iso])) $by[$iso] = $p;
    }
    uasort($by, fn($a, $b) => strcmp($a->post_title, $b->post_title));
    return array_values($by);
}

/** The first sentences of a report's standfirst, up to about 220 characters. */
function ed_site_excerpt(WP_Post $post): string {
    $r = ED_Parse::report($post->post_content);
    $text = trim(wp_strip_all_tags((string) ($r['overview']['standfirst'] ?? '')));
    if ($text === '' && $post->post_excerpt) $text = trim(wp_strip_all_tags($post->post_excerpt));
    if (mb_strlen($text) <= 230) return $text;
    $cut = mb_substr($text, 0, 230);
    $end = mb_strrpos($cut, '. ');
    if ($end !== false && $end > 80) return mb_substr($cut, 0, $end + 1);
    $sp = mb_strrpos($cut, ' ');
    return rtrim(mb_substr($cut, 0, $sp ?: 240), ' ,;:') . '…';
}

function ed_site_reports_index(array $a = []): string {
    $posts = ed_site_latest_reports();
    $head = !empty($a['title']) ? ed_home_block_head($a['title'], esc_html($a['aside'] ?? '')) : '';
    if (!$posts) return $head . '<p class="ed-none">No report published yet.</p>';
    $out = '<div class="ed-cards">';
    foreach ($posts as $p) {
        $iso = strtoupper((string) get_post_meta($p->ID, '_ed_iso', true));
        $sub = get_post_meta($p->ID, '_ed_subtitle', true);
        $edition = get_post_meta($p->ID, '_ed_edition', true) ?: get_the_date('F Y', $p) . ' edition';
        $r = ED_Parse::report($p->post_content);
        $date = trim((string) ($r['overview']['date'] ?? ''));
        $draft = $p->post_status !== 'publish' ? ' <span class="ed-draft">' . esc_html($p->post_status) . '</span>' : '';
        $url = get_permalink($p);
        $out .= '<article class="ed-card" style="--cc:' . ($iso ? ed_home_color($iso) : 'var(--accent)') . '">'
              . '<h3><a href="' . esc_url($url) . '">' . esc_html(get_the_title($p)) . '</a></h3>'
              . ($sub ? '<p class="sub">' . esc_html($sub) . '</p>' : '')
              . '<p class="ed">' . esc_html($edition) . ($date !== '' ? ' &middot; ' . esc_html($date) : '') . $draft . '</p>'
              . ($iso ? ed_home_card_extras($iso) : '')
              . '<p class="text">' . esc_html(ed_site_excerpt($p)) . '</p>'
              . '<p class="links"><a href="' . esc_url(function_exists('ed_reports_view_url') ? ed_reports_view_url($p, 'data') : $url) . '">Data view</a> <a href="' . esc_url(function_exists('ed_reports_view_url') ? ed_reports_view_url($p, 'report') : $url) . '">Report</a></p>'
              . '</article>';
    }
    return $head . $out . '</div>';
}
add_shortcode('ed_reports_index', fn($atts) => '<section class="ed-block ed-reports-block">' . ed_site_reports_index(shortcode_atts(['title' => '', 'aside' => ''], $atts, 'ed_reports_index')) . '</section>');
