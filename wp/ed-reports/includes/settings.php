<?php
/**
 * Settings > ED Reports: the API base and key, the cache, the texts shared by every report (global block, benchmark
 * note, scores line, method, footer), and a button to clear the cache.
 */
if (!defined('ABSPATH')) exit;

add_action('admin_menu', function () {
    add_options_page('ED Reports', 'ED Reports', 'manage_options', 'ed-reports', 'ed_reports_settings_page');
});

add_action('admin_init', function () {
    register_setting('ed_reports', ED_Api::OPTION, ['sanitize_callback' => 'ed_reports_sanitize']);
});

function ed_reports_sanitize($in): array {
    $cur = ED_Api::settings();
    $out = [];
    $in = is_array($in) ? $in : [];
    $out['api_base'] = esc_url_raw(trim((string) ($in['api_base'] ?? $cur['api_base'])));
    // the key is kept when the field is left blank, so that it never has to be retyped
    $out['api_key'] = trim((string) ($in['api_key'] ?? '')) !== '' ? trim((string) $in['api_key']) : $cur['api_key'];
    if (!empty($in['api_key_clear'])) $out['api_key'] = '';
    $out['cache_minutes'] = max(1, (int) ($in['cache_minutes'] ?? 60));
    $out['sector'] = strtoupper(preg_replace('/[^A-Za-z]/', '', (string) ($in['sector'] ?? 'APP'))) ?: 'APP';
    foreach (['edition', 'global_title', 'global_intro'] as $k) $out[$k] = sanitize_text_field((string) ($in[$k] ?? ''));
    foreach (['global_items', 'bench_foot', 'scores_lede', 'method_items', 'footer', 'paywall', 'paywall_out', 'site_footer'] as $k) $out[$k] = wp_kses_post((string) ($in[$k] ?? ''));
    $out['home_countries'] = strtoupper(preg_replace('/[^A-Za-z, ]/', '', (string) ($in['home_countries'] ?? '')));
    $out['show_print'] = empty($in['show_print']) ? 0 : 1;
    $out['fold'] = empty($in['fold']) ? 0 : 1;
    $out['default_view'] = ($in['default_view'] ?? 'data') === 'report' ? 'report' : 'data';
    $out['data_paragraphs'] = max(0, min(10, (int) ($in['data_paragraphs'] ?? 2)));
    ED_Api::clear_cache();
    return $out;
}

function ed_reports_settings_page(): void {
    if (!current_user_can('manage_options')) return;
    if (isset($_POST['ed_clear_cache']) && check_admin_referer('ed_clear_cache')) {
        ED_Api::clear_cache();
        echo '<div class="notice notice-success"><p>Cache cleared; the next page view fetches the API.</p></div>';
    }
    $s = ED_Api::settings();
    $o = ED_Api::OPTION;
    ?>
    <div class="wrap">
      <h1>ED Reports</h1>
      <form method="post" action="options.php">
        <?php settings_fields('ed_reports'); ?>
        <h2 class="title">API</h2>
        <table class="form-table" role="presentation">
          <tr><th scope="row"><label for="ed_api_base">API base</label></th>
              <td><input type="url" id="ed_api_base" name="<?php echo $o; ?>[api_base]" value="<?php echo esc_attr($s['api_base']); ?>" class="regular-text"></td></tr>
          <tr><th scope="row"><label for="ed_api_key">Client key</label></th>
              <td><input type="password" id="ed_api_key" name="<?php echo $o; ?>[api_key]" value="" class="regular-text" autocomplete="new-password" placeholder="<?php echo $s['api_key'] ? 'a key is stored; type to replace it' : 'none (open API)'; ?>">
                  <label style="margin-left:1em"><input type="checkbox" name="<?php echo $o; ?>[api_key_clear]" value="1"> remove the stored key</label>
                  <p class="description">Sent as the x-api-key header. Leave blank to keep the stored key.</p></td></tr>
          <tr><th scope="row"><label for="ed_sector">Sector</label></th>
              <td><input type="text" id="ed_sector" name="<?php echo $o; ?>[sector]" value="<?php echo esc_attr($s['sector']); ?>" style="width:6em"> <span class="description">scores and benchmark of this sector (APP)</span></td></tr>
          <tr><th scope="row"><label for="ed_cache">Cache, minutes</label></th>
              <td><input type="number" id="ed_cache" name="<?php echo $o; ?>[cache_minutes]" value="<?php echo (int) $s['cache_minutes']; ?>" min="1" style="width:6em">
                  <p class="description">How long a country's data is kept before the API is asked again. The last good answer is kept as a fallback.</p></td></tr>
        </table>

        <h2 class="title">Texts shared by every report</h2>
        <table class="form-table" role="presentation">
          <tr><th scope="row"><label for="ed_edition">Edition</label></th>
              <td><input type="text" id="ed_edition" name="<?php echo $o; ?>[edition]" value="<?php echo esc_attr($s['edition']); ?>" class="regular-text" placeholder="November 2026 edition"> <span class="description">masthead, when a report has none of its own</span></td></tr>
          <tr><th scope="row"><label for="ed_global_title">Global block, title</label></th>
              <td><input type="text" id="ed_global_title" name="<?php echo $o; ?>[global_title]" value="<?php echo esc_attr($s['global_title']); ?>" class="regular-text"></td></tr>
          <tr><th scope="row"><label for="ed_global_intro">Global block, line under the title</label></th>
              <td><input type="text" id="ed_global_intro" name="<?php echo $o; ?>[global_intro]" value="<?php echo esc_attr($s['global_intro']); ?>" class="large-text"></td></tr>
          <tr><th scope="row"><label for="ed_global_items">Global block, items</label></th>
              <td><textarea id="ed_global_items" name="<?php echo $o; ?>[global_items]" rows="8" class="large-text code"><?php echo esc_textarea($s['global_items']); ?></textarea>
                  <p class="description">One item per line: <code>Label|text</code>. Lines without text are left out. Printed by [ed_global] on every report.</p></td></tr>
          <tr><th scope="row"><label for="ed_bench_foot">Benchmark note</label></th>
              <td><textarea id="ed_bench_foot" name="<?php echo $o; ?>[bench_foot]" rows="4" class="large-text"><?php echo esc_textarea($s['bench_foot']); ?></textarea></td></tr>
          <tr><th scope="row"><label for="ed_scores_lede">Scores, line under the title</label></th>
              <td><textarea id="ed_scores_lede" name="<?php echo $o; ?>[scores_lede]" rows="3" class="large-text"><?php echo esc_textarea($s['scores_lede']); ?></textarea>
                  <p class="description">{score_date} is filled from the API.</p></td></tr>
          <tr><th scope="row"><label for="ed_method_items">Method</label></th>
              <td><textarea id="ed_method_items" name="<?php echo $o; ?>[method_items]" rows="6" class="large-text"><?php echo esc_textarea($s['method_items']); ?></textarea>
                  <p class="description">One point per line, printed by [ed_method] unless the report writes its own.</p></td></tr>
          <tr><th scope="row"><label for="ed_footer">Footer line</label></th>
              <td><input type="text" id="ed_footer" name="<?php echo $o; ?>[footer]" value="<?php echo esc_attr($s['footer']); ?>" class="large-text">
                  <p class="description">{name}, {fetched}, {score_month} are filled in.</p></td></tr>
          <tr><th scope="row"><label for="ed_paywall_out">Report locked, visitor</label></th>
              <td><textarea id="ed_paywall_out" name="<?php echo $o; ?>[paywall_out]" rows="2" class="large-text code"><?php echo esc_textarea($s['paywall_out']); ?></textarea>
                  <p class="description">Shown in place of a report to a reader who is not logged in (Paid Memberships Pro active). {login} and {home} are filled in.</p></td></tr>
          <tr><th scope="row"><label for="ed_paywall">Report locked, no subscription</label></th>
              <td><textarea id="ed_paywall" name="<?php echo $o; ?>[paywall]" rows="2" class="large-text code"><?php echo esc_textarea($s['paywall']); ?></textarea>
                  <p class="description">Shown to a logged-in reader without an active subscription.</p></td></tr>
          <tr><th scope="row"><label for="ed_home_countries">Home page countries</label></th>
              <td><input type="text" id="ed_home_countries" name="<?php echo $o; ?>[home_countries]" value="<?php echo esc_attr($s['home_countries']); ?>" class="regular-text" style="text-transform:uppercase">
                  <p class="description">Country codes, comma separated, in the order of the home page blocks (the opening chart, the figures of the morning, what changed).</p></td></tr>
          <tr><th scope="row"><label for="ed_site_footer">Site footer</label></th>
              <td><textarea id="ed_site_footer" name="<?php echo $o; ?>[site_footer]" rows="3" class="large-text code"><?php echo esc_textarea($s['site_footer']); ?></textarea>
                  <p class="description">The line at the foot of every page of the site (HTML allowed); {year} and {home} are filled in. Empty keeps the theme's own line.</p></td></tr>
          <tr><th scope="row">Default view</th>
              <td><label><input type="radio" name="<?php echo $o; ?>[default_view]" value="data" <?php checked($s['default_view'], 'data'); ?>> data view</label> &nbsp;
                  <label><input type="radio" name="<?php echo $o; ?>[default_view]" value="report" <?php checked($s['default_view'], 'report'); ?>> report view</label>
                  <p class="description">What /reports/&lt;country&gt;/ shows; the other view is at /report/ or /data/ after the address, and the switch in the masthead.</p></td></tr>
          <tr><th scope="row"><label for="ed_data_paragraphs">Data view, paragraphs per section</label></th>
              <td><input type="number" id="ed_data_paragraphs" name="<?php echo $o; ?>[data_paragraphs]" value="<?php echo (int) $s['data_paragraphs']; ?>" min="0" max="10" style="width:5em"> <span class="description">of the section's analysis shown after the lead (0 for the lead alone)</span></td></tr>
          <tr><th scope="row">Screen reading</th>
              <td><label><input type="checkbox" name="<?php echo $o; ?>[fold]" value="1" <?php checked($s['fold']); ?>> fold the month's updates and the figures of each section behind one line (the reader opens them; "Expand all" in the contents bar; print shows everything)</label></td></tr>
          <tr><th scope="row">Print button</th>
              <td><label><input type="checkbox" name="<?php echo $o; ?>[show_print]" value="1" <?php checked($s['show_print']); ?>> show a Print button in the masthead</label></td></tr>
        </table>
        <?php submit_button(); ?>
      </form>

      <h2 class="title">Cache</h2>
      <form method="post">
        <?php wp_nonce_field('ed_clear_cache'); ?>
        <p><button type="submit" name="ed_clear_cache" value="1" class="button">Clear the API cache</button> <span class="description">after a database refresh, to show the new figures at once</span></p>
      </form>
      <?php
      $log = get_option('ed_reports_log', []);
      if ($log) {
          echo '<h2 class="title">Last API messages</h2><pre style="background:#fff;border:1px solid #ccd0d4;padding:8px;max-width:800px;overflow:auto">' . esc_html(implode("\n", array_reverse($log))) . '</pre>';
      }
      ?>
      <h2 class="title">Shortcodes</h2>
      <p>The text of a report is written in the editor (Text tab) with these shortcodes; the plugin's readme has the full list and an example.</p>
      <pre style="background:#fff;border:1px solid #ccd0d4;padding:8px;max-width:800px;overflow:auto">[ed_overview date="21 November 2026"][ed_standfirst]...[/ed_standfirst] &lt;h3&gt;...&lt;/h3&gt;&lt;p&gt;...&lt;/p&gt; [ed_byline]...[/ed_byline][/ed_overview]
[ed_global]
[ed_section key="FIN"]
  [ed_lead]...[/ed_lead]
  [ed_currency then="Public finances and the banks" rate="26.91" rate_note="HNL per USD, 20 Nov 2026"]one sentence per line[/ed_currency]
  [ed_text]one sentence per line

a blank line starts a new paragraph[/ed_text]
  [ed_updates][ed_update dir="up"]...[/ed_update][ed_update dir="down"]...[/ed_update][/ed_updates]
  [ed_figs][ed_fig label="Reserves" value="USD 9.1 bn" code="EXT_RES"]note[/ed_fig][/ed_figs]
  [ed_charts][ed_chart code="EXT_RES" title="Reserves" unit="USD million" decimals="0"][/ed_charts]
  [ed_risks][ed_risk level="high" title="..." horizon="to March"]text[ed_watch]...[/ed_watch][/ed_risk][/ed_risks]
  [ed_gap]...[/ed_gap]
[/ed_section]
[ed_facts][ed_fact label="Currency"]...[/ed_fact][/ed_facts]
[ed_benchmark]
[ed_scores]
[ed_method][ed_sources]one source per line[/ed_sources][/ed_method]</pre>
    </div>
    <?php
}
