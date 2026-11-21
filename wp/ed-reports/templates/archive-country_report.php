<?php
/** The list of country reports, newest first. */
if (!defined('ABSPATH')) exit;
get_header();
?>
<div class="ed-report ed-archive">
  <div class="page">
    <header class="mast"><div class="brand"><span class="wordmark">EmergingData</span><span>Country reports</span></div></header>
    <section class="title"><h1><?php echo is_tax() ? esc_html(single_term_title('', false)) : 'Country reports'; ?></h1></section>
    <section class="list">
    <?php if (have_posts()) : while (have_posts()) : the_post(); ?>
      <article class="item">
        <h2><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h2>
        <?php $sub = get_post_meta(get_the_ID(), '_ed_subtitle', true); if ($sub) echo '<p class="sub">' . esc_html($sub) . '</p>'; ?>
        <p class="small"><?php echo esc_html(get_post_meta(get_the_ID(), '_ed_edition', true) ?: get_the_date('j F Y')); ?></p>
        <?php if (has_excerpt()) echo '<p class="text">' . esc_html(get_the_excerpt()) . '</p>'; ?>
      </article>
    <?php endwhile; the_posts_pagination(); else : ?>
      <p class="small">No report yet.</p>
    <?php endif; ?>
    </section>
  </div>
</div>
<?php
get_footer();
