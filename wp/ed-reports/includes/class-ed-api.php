<?php
/**
 * The EmergingData API: one call per country (/api/page-data), cached in a transient for the number of minutes set
 * in the settings, with the last good answer kept in an option so that a page never breaks when the API is down.
 */
if (!defined('ABSPATH')) exit;

class ED_Api {

    const OPTION = 'ed_reports_settings';

    public static function settings(): array {
        $defaults = [
            'api_base'      => 'https://emergingdata-api.vercel.app',
            'api_key'       => '',
            'cache_minutes' => 60,
            'sector'        => 'APP',
            'edition'       => '',
            'global_title'  => 'Global context this month',
            'global_intro'  => 'One block shared by every country page, written once a month from the global series.',
            'global_items'  => "Oil|\nFreight|\nDemand|\nTariffs|",
            'bench_foot'    => 'Wage: the garment sector wage where one exists, otherwise the general minimum wage, converted at the latest monthly exchange rate. Public debt: general government, last actual year, IMF WEO. Apparel exports: twelve months to the last month available; US imports from OTEXA for Kenya and Honduras, national customs data for Bangladesh, Cambodia and Pakistan, so the two groups are not comparable in scope. Tariff: on the main destination market, US or EU. Real move: the twelve-month change against the dollar corrected for the inflation differential with the US (US inflation taken at 3% a year, as in the scores); a positive figure means local costs became dearer in dollars.',
            'scores_lede'   => 'The scoring engine\'s reading of {score_date}, by section, with the two composites. Cost: 1 lowest pressure on the sourcing cost, 5 highest. Risk: 1 lowest disruption risk, 5 highest. The arrow compares with the inputs of three to six months earlier.',
            'method_items'  => "Each section opens with its introduction and a short analysis, then the month's updates and the figures behind them with their direction; the \"to add\" line names the indicators of the template not loaded yet.\nDated events (elections, wage reviews, preference dates) feed the scores but are not listed on the page.\nThe scores in the appendix follow published rules on one or two inputs each; ranks (inflation, wage) are among the countries covered.\nScores are frozen on the first day of the month from the data available that day; the sections show the latest data, so a figure can be newer than the score.\nValues marked \"verify\" are awaiting a check and are not used in the scores.",
            'footer'        => 'EmergingData country report, {name}, apparel. Built from the EmergingData API; series to {fetched}. Scores of {score_month}.',
            'paywall'       => '<p>This report is for subscribers. Your account has no active subscription: <a href="{home}subscribe/">see the subscription</a>.</p>',
            'paywall_out'   => '<p>This report is for subscribers. <a href="{login}">Log in</a> if you have an account, or <a href="{home}subscribe/">see the subscription</a>.</p>',
            'home_countries' => 'BGD, KHM, HND, KEN, PAK',
            'site_footer'   => 'EmergingData, by <a href="https://emergingtextiles.com">EmergingTextiles.com</a> &middot; <a href="{home}methodology/">Methodology</a> &middot; <a href="{home}legal-notice/">Legal notice</a> &middot; <a href="{home}privacy/">Privacy</a> &middot; &copy; {year} EmergingTextiles.com SARL',
            'show_print'    => 1,
            'fold'          => 1,
            'default_view'  => 'data',
            'data_paragraphs' => 2,
        ];
        $saved = get_option(self::OPTION, []);
        return array_merge($defaults, is_array($saved) ? $saved : []);
    }

    public static function setting(string $key) {
        $s = self::settings();
        return $s[$key] ?? null;
    }

    /** The page data of a country, as an associative array, or null. */
    public static function page_data(string $iso, bool $force = false): ?array {
        $iso = strtoupper(preg_replace('/[^A-Za-z]/', '', $iso));
        if (strlen($iso) !== 3) return null;
        $key = 'ed_pd_' . $iso . '_' . strtolower((string) self::setting('sector'));
        if (!$force) {
            $cached = get_transient($key);
            if (is_array($cached)) return $cached;
        }
        $data = self::fetch($iso);
        if ($data) {
            $minutes = max(1, (int) self::setting('cache_minutes'));
            set_transient($key, $data, $minutes * MINUTE_IN_SECONDS);
            update_option('ed_last_good_' . $iso, $data, false);
            return $data;
        }
        $last = get_option('ed_last_good_' . $iso);
        return is_array($last) ? $last : null;
    }

    private static function fetch(string $iso): ?array {
        $s = self::settings();
        $url = rtrim((string) $s['api_base'], '/') . '/api/page-data?' . http_build_query(['country' => $iso, 'sector' => $s['sector']]);
        $headers = ['Accept' => 'application/json'];
        if (!empty($s['api_key'])) $headers['x-api-key'] = $s['api_key'];
        $r = wp_remote_get($url, ['timeout' => 25, 'headers' => $headers]);
        if (is_wp_error($r)) {
            self::log('fetch ' . $iso . ': ' . $r->get_error_message());
            return null;
        }
        $code = wp_remote_retrieve_response_code($r);
        if ($code !== 200) {
            self::log('fetch ' . $iso . ': HTTP ' . $code);
            return null;
        }
        $data = json_decode(wp_remote_retrieve_body($r), true);
        if (!is_array($data) || empty($data['country'])) {
            self::log('fetch ' . $iso . ': unreadable answer');
            return null;
        }
        return $data;
    }

    /** Forget every cached answer (the last good copies stay). */
    public static function clear_cache(): void {
        global $wpdb;
        $like = $wpdb->esc_like('_transient_ed_pd_') . '%';
        $names = $wpdb->get_col($wpdb->prepare("SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s", $like));
        foreach ($names as $n) delete_transient(substr($n, strlen('_transient_')));
    }

    public static function log(string $msg): void {
        $log = get_option('ed_reports_log', []);
        if (!is_array($log)) $log = [];
        $log[] = current_time('Y-m-d H:i') . ' ' . $msg;
        update_option('ed_reports_log', array_slice($log, -20), false);
    }
}
