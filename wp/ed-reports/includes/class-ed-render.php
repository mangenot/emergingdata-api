<?php
/**
 * The HTML pieces of a report and the state of the page being rendered: the country's data from the API, the chart
 * specifications collected from the shortcodes, the running section number. The script of the page reads the
 * collected data (series, charts, benchmark, scores) from one JSON block printed in the footer.
 */
if (!defined('ABSPATH')) exit;

class ED_Render {

    /** The sections in the editor's order: key => [chapter title, short name for the contents line]. */
    const SECTIONS = [
        'FIN' => ['Public finances and external position', 'Finances'],
        'EXT' => ['Exports, imports and tariffs', 'External trade'],
        'POL' => ['Politics, social climate and labour costs', 'Politics and labour'],
        'LOG' => ['Logistics and shipping costs', 'Logistics'],
        'ENE' => ['Energy costs', 'Energy'],
    ];

    private static ?int $post_id = null;
    private static ?array $data = null;
    private static array $charts = [];
    private static int $section_n = 0;
    private static bool $used = false;

    // ---------------------------------------------------------------- state
    public static function begin(int $post_id): void {
        if (self::$post_id === $post_id) return;
        self::$post_id = $post_id;
        self::$data = null;
        self::$charts = [];
        self::$section_n = 0;
        $iso = get_post_meta($post_id, '_ed_iso', true);
        if ($iso) {
            self::$data = ED_Api::page_data($iso);
            if (self::$data) {
                $S = self::$data['series'] ?? [];
                if (!empty(self::$data['fx_real'])) $S['FX_REAL'] = self::$data['fx_real'];
                self::$data['series'] = $S;
                $code = self::$data['currency'] ?: 'local currency';
                self::$charts['FX_USD'] = ['title' => 'Exchange rate', 'unit' => $code . ' per USD, monthly average', 'decimals' => 2, 'tickDecimals' => 1, 'series' => [['name' => 'Rate', 'code' => 'FX_USD']]];
                self::$charts['FX_REAL'] = ['title' => 'Real exchange rate', 'unit' => $code . ' per USD adjusted for the inflation differential with the US (US inflation taken at three per cent a year, as in the scores), index Jan 2020 = 100; a rise means cheaper in dollars',
                                            'decimals' => 1, 'tickDecimals' => 0, 'series' => [['name' => 'Real rate', 'code' => 'FX_REAL']]];
            }
        }
    }

    public static function used(): void { self::$used = true; }
    public static function is_used(): bool { return self::$used; }
    public static function data(): ?array { return self::$data; }
    public static function series(): array { return self::$data['series'] ?? []; }
    public static function iso(): string { return self::$data['country'] ?? (string) get_post_meta((int) self::$post_id, '_ed_iso', true); }
    public static function add_chart(string $code, array $spec): void { self::$charts[$code] = $spec; }
    public static function charts(): array { return self::$charts; }
    public static function next_section(): int { return ++self::$section_n; }

    /** The number of scored countries in the benchmark (for "rank x of n"). */
    public static function covered(): int {
        $n = count(self::$data['bench'] ?? []);
        return $n ?: 5;
    }

    /** The data block for the script: ISO, TODAY, SERIES, CHARTS, SCORES, BENCH, EVENTS. */
    public static function data_block(): array {
        $d = self::$data ?? [];
        return [
            'ISO' => self::iso(), 'TODAY' => current_time('Y-m-d'),
            'SERIES' => $d['series'] ?? [], 'CHARTS' => self::$charts,
            'SCORES' => ED_Calc::scores_block($d['scores'] ?? null, self::covered()),
            'BENCH' => $d['bench'] ?? [], 'EVENTS' => [],
            'FACTS' => $d['facts'] ?? [],
        ];
    }

    /** Fill {series}, {fetched}, {name}, {score_date}, {score_month} in a hand-written line. */
    public static function fill(string $text): string {
        $d = self::$data ?? [];
        $gen = isset($d['generated']) ? substr($d['generated'], 0, 10) : current_time('Y-m-d');
        $n = count(array_filter(array_keys($d['series'] ?? []), fn($k) => $k !== 'FX_REAL'));
        $sd = $d['scores']['score_date'] ?? '';
        $post = self::$post_id ? get_post(self::$post_id) : null;
        return str_replace(
            ['{series}', '{fetched}', '{name}', '{score_date}', '{score_month}'],
            [ED_Calc::date_label($gen) . " ($n series)", ED_Calc::date_label($gen), $post ? $post->post_title : '', ED_Calc::date_label($sd), $sd ? ED_Calc::MONTH_NAMES[(int) substr($sd, 5, 2) - 1] . ' ' . substr($sd, 0, 4) : ''],
            $text
        );
    }

    // ---------------------------------------------------------------- html pieces
    public static function trend_html(?array $tr): string {
        if (!$tr) return '';
        [$a, $b] = $tr['labels'] ?? ['short', 'long'];
        $when = !empty($tr['when']) ? ' <span class="h">(' . esc_html($tr['when']) . ')</span>' : '';
        $A = ED_Calc::ARROW; $W = ED_Calc::WORD;
        $dir = $tr['dir'] ?? 'flat'; $sh = $tr['short'] ?? 'flat'; $lo = $tr['long'] ?? 'flat';
        return '<div class="trend"><div><span class="d ' . esc_attr($dir) . '">' . $A[$dir] . '</span> ' . esc_html(ED_Calc::minus((string) ($tr['change'] ?? ''))) . $when . '</div>'
             . '<div><span class="h">' . esc_html($a) . '</span> <span class="d ' . esc_attr($sh) . '">' . $A[$sh] . '</span> ' . $W[$sh] . ' &middot; '
             . '<span class="h">' . esc_html($b) . '</span> <span class="d ' . esc_attr($lo) . '">' . $A[$lo] . '</span> ' . $W[$lo] . '</div></div>';
    }

    /** A tile: label, value (HTML allowed), unit, note (HTML allowed), and a trend given or computed from the code. */
    public static function fig_html(array $f): string {
        $value = $f['value'] ?? '';
        $v = ($value === null || $value === '') ? '&ndash;' : $value;
        $tr = $f['trend'] ?? null;
        if (!$tr && !empty($f['code'])) $tr = ED_Calc::series_trend(self::series(), $f['code']);
        return '<div class="fig"><span class="label">' . esc_html($f['label'] ?? '') . '</span><div class="v">' . $v
             . (!empty($f['unit']) ? '<small>' . esc_html($f['unit']) . '</small>' : '') . '</div><div class="s">' . ($f['note'] ?? '') . '</div>'
             . self::trend_html($tr) . '</div>';
    }

    /** The month's updates, ordered up, flat, down. Each item: [dir, html]. */
    public static function updates_html(array $ups): string {
        if (!$ups) return '';
        usort($ups, fn($x, $y) => (ED_Calc::DIR_ORDER[$x[0]] ?? 1) <=> (ED_Calc::DIR_ORDER[$y[0]] ?? 1));
        $out = '<ul class="updates">';
        foreach ($ups as [$d, $t]) $out .= '<li><span class="d ' . esc_attr($d) . '">' . ED_Calc::ARROW[$d] . '</span>' . $t . '</li>';
        return $out . '</ul>';
    }

    /** One sentence per line: newlines become <br>. */
    public static function lines(string $text): string {
        $text = trim($text);
        $text = preg_replace('/\s*\n\s*/', '<br>', $text);
        return $text;
    }

    /** Fold the month's updates and the figures of a section behind one line (or just drop the markers). */
    public static function fold(string $body, bool $fold): string {
        $one = function ($html, $ups, $figs) use ($fold) {
            if (!$fold) return $html;
            $parts = [];
            if ($ups) $parts[] = 'updates (' . $ups . ')';
            if ($figs) $parts[] = 'figures (' . $figs . ')';
            $what = "The month's " . ($parts ? implode(' and ', $parts) : 'details');
            return '<details class="fold"><summary><span class="what">' . esc_html($what) . '</span><span class="toggle" aria-hidden="true"></span></summary><div class="fold-body">' . $html . '</div></details>';
        };
        $body = preg_replace_callback('/<!--ed:updates:(\d+)-->(.*?)<!--\/ed:updates-->\s*<!--ed:figs:(\d+)-->(.*?)<!--\/ed:figs-->/s', fn($m) => $one($m[2] . $m[4], (int) $m[1], (int) $m[3]), $body);
        $body = preg_replace_callback('/<!--ed:updates:(\d+)-->(.*?)<!--\/ed:updates-->/s', fn($m) => $one($m[2], (int) $m[1], 0), $body);
        $body = preg_replace_callback('/<!--ed:figs:(\d+)-->(.*?)<!--\/ed:figs-->/s', fn($m) => $one($m[2], 0, (int) $m[1]), $body);
        return $body;
    }

    /** The latest value of a series formatted for a tile, with its month as the note. */
    public static function auto_value(string $code, int $decimals, ?float $scale = null): array {
        [$v, $m] = ED_Calc::series_last(self::series(), $code);
        if ($v === null) return ['', ''];
        if ($scale) $v *= $scale;
        return [ED_Calc::fmt($v, $decimals), ED_Calc::month_label($m)];
    }
}
