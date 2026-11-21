<?php
/**
 * A country report: the theme's header and footer around the report column. Copy this file into the theme to
 * change the frame; the pieces inside come from the plugin.
 */
if (!defined('ABSPATH')) exit;
get_header();
while (have_posts()) : the_post();
    $post = get_post();
    ?>
    <div class="ed-report">
      <div class="page">
        <?php echo ed_reports_title_block($post); ?>
        <div class="ed-body">
          <?php the_content(); ?>
        </div>
        <?php echo ed_reports_footer_line($post); ?>
      </div>
    </div>
    <?php
endwhile;
get_footer();
