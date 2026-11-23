<?php
/**
 * The "Country report" post type: the text of a report is the post content (HTML and shortcodes, edited in the
 * classic editor so that nothing is rewritten), and three fields in a box: country code, subtitle, series line.
 */
if (!defined('ABSPATH')) exit;

function ed_reports_register_post_type(): void {
    register_post_type('country_report', [
        'labels' => [
            'name' => 'Country reports', 'singular_name' => 'Country report', 'add_new' => 'Add report', 'add_new_item' => 'Add country report',
            'edit_item' => 'Edit country report', 'new_item' => 'New country report', 'view_item' => 'View report', 'search_items' => 'Search reports',
            'not_found' => 'No report found', 'all_items' => 'All reports', 'menu_name' => 'Country reports',
        ],
        'public' => true, 'has_archive' => 'reports', 'rewrite' => ['slug' => 'reports', 'with_front' => false],
        'menu_icon' => 'dashicons-analytics', 'menu_position' => 5,
        'supports' => ['title', 'editor', 'excerpt', 'revisions', 'author', 'thumbnail', 'custom-fields'],   // custom-fields: the report fields travel through the REST API
        'show_in_rest' => true, 'rest_base' => 'country-reports',    // for the publishing script; the editor stays classic (below)
        'taxonomies' => ['country_tag'],
    ]);
    foreach (['_ed_iso' => 'Country code', '_ed_subtitle' => 'Subtitle', '_ed_edition' => 'Edition', '_ed_meta' => 'Series line', '_ed_selected' => 'Selected data'] as $key => $desc) {
        register_post_meta('country_report', $key, [
            'type' => 'string', 'single' => true, 'description' => $desc,
            'show_in_rest' => true, 'auth_callback' => fn() => current_user_can('edit_posts'),
            'sanitize_callback' => $key === '_ed_meta' ? 'wp_kses_post' : 'sanitize_text_field',
        ]);
    }
    register_taxonomy('country_tag', 'country_report', [
        'labels' => ['name' => 'Report tags', 'singular_name' => 'Report tag'],
        'public' => true, 'hierarchical' => false, 'show_admin_column' => true, 'rewrite' => ['slug' => 'report-tag'],
    ]);
}
add_action('init', 'ed_reports_register_post_type');

// The classic editor for this post type, and no automatic paragraphs or typographic rewriting of its content.
add_filter('use_block_editor_for_post_type', function ($use, $type) { return $type === 'country_report' ? false : $use; }, 10, 2);
add_filter('run_wptexturize', function ($run) {
    if (is_singular('country_report') || (is_admin() && (get_post_type() === 'country_report'))) return false;
    return $run;
});
add_action('wp', function () {
    if (is_singular('country_report')) {
        remove_filter('the_content', 'wpautop');
        remove_filter('the_content', 'wptexturize');
        remove_filter('the_excerpt', 'wpautop');
    }
});

// ---------------------------------------------------------------- the report fields
add_action('add_meta_boxes', function () {
    add_meta_box('ed_report_fields', 'Report', 'ed_reports_meta_box', 'country_report', 'side', 'high');
});

function ed_reports_meta_box(WP_Post $post): void {
    wp_nonce_field('ed_report_fields', 'ed_report_fields_nonce');
    $iso = get_post_meta($post->ID, '_ed_iso', true);
    $sub = get_post_meta($post->ID, '_ed_subtitle', true);
    $meta = get_post_meta($post->ID, '_ed_meta', true);
    $edition = get_post_meta($post->ID, '_ed_edition', true);
    $selected = get_post_meta($post->ID, '_ed_selected', true);
    ?>
    <p><label for="ed_iso"><strong>Country code</strong> (ISO3, as in the API)</label><br>
       <input type="text" id="ed_iso" name="ed_iso" value="<?php echo esc_attr($iso); ?>" maxlength="3" style="width:6em;text-transform:uppercase" placeholder="HND"></p>
    <p><label for="ed_subtitle"><strong>Subtitle</strong></label><br>
       <input type="text" id="ed_subtitle" name="ed_subtitle" value="<?php echo esc_attr($sub); ?>" style="width:100%" placeholder="Apparel sourcing profile"></p>
    <p><label for="ed_edition"><strong>Edition</strong> (masthead)</label><br>
       <input type="text" id="ed_edition" name="ed_edition" value="<?php echo esc_attr($edition); ?>" style="width:100%" placeholder="November 2026 edition"></p>
    <p><label for="ed_selected"><strong>Selected data</strong> (data view: series codes, comma separated; empty for the six latest releases)</label><br>
       <input type="text" id="ed_selected" name="ed_selected" value="<?php echo esc_attr($selected); ?>" style="width:100%;text-transform:uppercase" placeholder="INF_CPI, FIN_POLICY, EXT_RES, TRD_APP_EXP"></p>
    <p><label for="ed_meta"><strong>Series line</strong> (under the subtitle; {series} is filled from the API)</label><br>
       <textarea id="ed_meta" name="ed_meta" rows="3" style="width:100%" placeholder="Series to {series}. Scores of 1 November 2026."><?php echo esc_textarea($meta); ?></textarea></p>
    <?php
    $data = $iso ? ED_Api::page_data($iso) : null;
    if ($iso) {
        echo '<p class="description">API: ' . ($data ? 'data of ' . esc_html(substr($data['generated'] ?? '', 0, 16)) . ' UTC, ' . count($data['series'] ?? []) . ' series' : 'no data for this code') . '</p>';
    }
}

add_action('save_post_country_report', function (int $post_id) {
    if (!isset($_POST['ed_report_fields_nonce']) || !wp_verify_nonce($_POST['ed_report_fields_nonce'], 'ed_report_fields')) return;
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) return;
    if (!current_user_can('edit_post', $post_id)) return;
    update_post_meta($post_id, '_ed_iso', strtoupper(preg_replace('/[^A-Za-z]/', '', (string) ($_POST['ed_iso'] ?? ''))));
    update_post_meta($post_id, '_ed_subtitle', sanitize_text_field(wp_unslash($_POST['ed_subtitle'] ?? '')));
    update_post_meta($post_id, '_ed_edition', sanitize_text_field(wp_unslash($_POST['ed_edition'] ?? '')));
    update_post_meta($post_id, '_ed_meta', wp_kses_post(wp_unslash($_POST['ed_meta'] ?? '')));
    update_post_meta($post_id, '_ed_selected', strtoupper(preg_replace('/[^A-Za-z0-9_, ]/', '', (string) ($_POST['ed_selected'] ?? ''))));
});

// The country code and the API state in the list of reports.
add_filter('manage_country_report_posts_columns', function ($cols) {
    $out = [];
    foreach ($cols as $k => $v) {
        $out[$k] = $v;
        if ($k === 'title') $out['ed_iso'] = 'Country';
    }
    return $out;
});
add_action('manage_country_report_posts_custom_column', function ($col, $post_id) {
    if ($col === 'ed_iso') echo esc_html(get_post_meta($post_id, '_ed_iso', true));
}, 10, 2);
