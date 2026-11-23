<?php
/**
 * Plugin Name: ED Reports
 * Plugin URI:  https://emergingdata.net
 * Description: Country reports for EmergingData: a "Country report" post type whose text is written in the editor with shortcodes, and whose figures, tiles, charts, benchmark table and scores are filled from the EmergingData API at display time.
 * Version:     1.2.1
 * Author:      EmergingTextiles
 * License:     Proprietary
 * Text Domain: ed-reports
 * Requires PHP: 8.0
 */

if (!defined('ABSPATH')) exit;

define('ED_REPORTS_VERSION', '1.2.1');
define('ED_REPORTS_FILE', __FILE__);
define('ED_REPORTS_DIR', plugin_dir_path(__FILE__));
define('ED_REPORTS_URL', plugin_dir_url(__FILE__));

require_once ED_REPORTS_DIR . 'includes/auth-header.php';
require_once ED_REPORTS_DIR . 'includes/class-ed-api.php';
require_once ED_REPORTS_DIR . 'includes/class-ed-calc.php';
require_once ED_REPORTS_DIR . 'includes/class-ed-render.php';
require_once ED_REPORTS_DIR . 'includes/post-type.php';
require_once ED_REPORTS_DIR . 'includes/shortcodes.php';
require_once ED_REPORTS_DIR . 'includes/settings.php';
require_once ED_REPORTS_DIR . 'includes/class-ed-parse.php';
require_once ED_REPORTS_DIR . 'includes/dataview.php';
require_once ED_REPORTS_DIR . 'includes/template.php';

register_activation_hook(__FILE__, function () {
    ed_reports_register_post_type();
    flush_rewrite_rules();
});
register_deactivation_hook(__FILE__, function () {
    flush_rewrite_rules();
});
