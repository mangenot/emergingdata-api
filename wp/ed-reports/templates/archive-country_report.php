<?php
/** The reports index: the latest report of each country, inside the site frame. */
if (!defined('ABSPATH')) exit;
get_header();
?>
<div class="ed-report ed-archive">
  <div class="page">
    <section class="title"><h1><?php echo is_tax() ? esc_html(single_term_title('', false)) : 'Country reports'; ?></h1>
      <p class="sub">The monthly report of each country covered, in two views: the data view on screen, the full report for reading and printing.</p></section>
    <section class="list"><?php echo ed_site_reports_index(); ?></section>
  </div>
</div>
<?php
get_footer();
