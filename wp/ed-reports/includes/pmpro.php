<?php
/**
 * Paid Memberships Pro: every country report needs an active membership (no box to tick on each report), the
 * "Log in" menu item goes to PMPro's login page and reads "My account" for a logged-in reader, and the message
 * shown in place of a report comes from the settings. Nothing here runs when PMPro is not active.
 */
if (!defined('ABSPATH')) exit;

/** Whether PMPro decides access on this site. */
function ed_pmpro_active(): bool {
    return function_exists('pmpro_has_membership_access') && function_exists('pmpro_hasMembershipLevel');
}

// Every report requires an active level of the reader (editors are let through by ed_reports_can_view).
add_filter('pmpro_has_membership_access_filter', function ($hasaccess, $post, $user, $levels) {
    if (!$post || $post->post_type !== 'country_report') return $hasaccess;
    if (!$user || empty($user->ID)) return false;
    return (bool) pmpro_hasMembershipLevel(null, $user->ID);
}, 10, 4);

// The reports are listed everywhere (cards, index, search); only their body is for members.
add_filter('pmpro_search_filter_post_types', fn($types) => array_diff((array) $types, ['country_report']));

// The "Log in" item of the main menu: PMPro's login page, and the account page once logged in.
add_filter('wp_nav_menu_objects', function ($items) {
    if (!ed_pmpro_active() || !function_exists('pmpro_url')) return $items;
    foreach ($items as $item) {
        if (!in_array('menu-login', (array) $item->classes, true)) continue;
        if (is_user_logged_in()) { $item->title = 'My account'; $item->url = pmpro_url('account') ?: $item->url; }
        else { $item->url = pmpro_url('login') ?: $item->url; }
    }
    return $items;
}, 20);

// The message in place of a report's body, for visitors and for logged-in readers without a subscription.
add_filter('pmpro_non_member_text_filter', function ($text) {
    $own = trim((string) ED_Api::setting('paywall'));
    return $own !== '' ? wp_kses_post(ED_Render::fill($own)) : $text;
});
add_filter('pmpro_not_logged_in_text_filter', function ($text) {
    $own = trim((string) ED_Api::setting('paywall_out'));
    return $own !== '' ? wp_kses_post(ED_Render::fill($own)) : $text;
});
