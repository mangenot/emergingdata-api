<?php
/**
 * The data view of a country report: the theme's header and footer around the page. Copy this file into the theme
 * to change the frame; the pieces inside come from the plugin.
 */
if (!defined('ABSPATH')) exit;
get_header();
while (have_posts()) : the_post();
    $post = get_post();
    ED_Render::used();
    ?>
    <div class="ed-report ed-data">
      <div class="page">
        <?php echo ed_reports_title_block($post); ?>
        <div class="ed-body">
          <?php if (ed_reports_can_view($post->ID)) echo ed_reports_data_view($post); else the_content(); ?>
        </div>
        <?php echo ed_reports_footer_line($post); ?>
      </div>
    </div>
    <?php
endwhile;
get_footer();
