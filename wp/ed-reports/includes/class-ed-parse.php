<?php
/**
 * Reads the structure of a report out of its post content (the shortcodes), for the data view: the overview, the
 * sections with their lead, text, updates, figures, charts, risks and gap, the standing facts and the sources. The
 * report view does not need this: it renders the shortcodes straight. Nothing here runs the shortcodes.
 */
if (!defined('ABSPATH')) exit;

class ED_Parse {

    /** All [tag attrs]inner[/tag] occurrences: [[atts, inner], ...]. */
    private static function items(string $content, string $tag): array {
        $out = [];
        if (preg_match_all('/\[' . $tag . '((?:\s[^\]]*)?)\](.*?)\[\/' . $tag . '\]/s', $content, $m, PREG_SET_ORDER)) {
            foreach ($m as $x) $out[] = [shortcode_parse_atts(trim($x[1])) ?: [], $x[2]];
        }
        return $out;
    }

    /** The first [tag ...]inner[/tag]: [atts, inner] or null. */
    private static function first(string $content, string $tag): ?array {
        $i = self::items($content, $tag);
        return $i ? $i[0] : null;
    }

    /** Self-closing [tag attrs] occurrences (without inner content): [atts, ...]. */
    private static function selfClosing(string $content, string $tag): array {
        $out = [];
        if (preg_match_all('/\[' . $tag . '\s([^\]]*)\]/', $content, $m)) foreach ($m[1] as $raw) $out[] = shortcode_parse_atts(trim($raw)) ?: [];
        return $out;
    }

    /** The sentences of an [ed_text], one per line in the editor, each a paragraph of the data view. */
    private static function paragraphs(string $text): array {
        $out = [];
        foreach (preg_split('/\r?\n/', trim($text)) as $p) {
            $p = trim($p);
            if ($p !== '') $out[] = $p;
        }
        return $out;
    }

    /** Unescape the brackets the converter writes into attributes. */
    private static function att($v): string {
        return str_replace(['&#91;', '&#93;', '&quot;'], ['[', ']', '"'], (string) $v);
    }

    public static function report(string $content): array {
        $r = ['overview' => null, 'sections' => [], 'facts' => [], 'sources' => [], 'charts' => []];
        // overview
        if ($ov = self::first($content, 'ed_overview')) {
            [$a, $inner] = $ov;
            $standfirst = ($x = self::first($inner, 'ed_standfirst')) ? trim($x[1]) : '';
            $byline = ($x = self::first($inner, 'ed_byline')) ? trim($x[1]) : '';
            $inner = preg_replace('/\[ed_standfirst\].*?\[\/ed_standfirst\]|\[ed_byline\].*?\[\/ed_byline\]/s', '', $inner);
            $paras = [];
            if (preg_match_all('/<h3[^>]*>(.*?)<\/h3>|<p[^>]*>(.*?)<\/p>/s', $inner, $m, PREG_SET_ORDER)) {
                $cur = ['', []];
                foreach ($m as $x) {
                    if ($x[1] !== '' && isset($x[1]) && trim($x[1]) !== '') { if ($cur[1]) $paras[] = $cur; $cur = [trim($x[1]), []]; }
                    elseif (isset($x[2])) $cur[1][] = trim($x[2]);
                }
                if ($cur[1]) $paras[] = $cur;
            }
            $r['overview'] = ['date' => self::att($a['date'] ?? ''), 'standfirst' => $standfirst, 'paras' => $paras, 'byline' => $byline];
        }
        // sections
        foreach (self::items($content, 'ed_section') as [$a, $inner]) {
            $key = strtoupper(self::att($a['key'] ?? ''));
            $def = ED_Render::SECTIONS[$key] ?? [self::att($a['title'] ?? 'Section'), self::att($a['short'] ?? ($a['title'] ?? 'Section'))];
            $sec = ['key' => $key, 'title' => $a['title'] ?? $def[0], 'short' => $a['short'] ?? $def[1], 'lead' => '', 'text' => [], 'updates' => [], 'figs' => [], 'charts' => [], 'risks' => [], 'gap' => '', 'currency_text' => []];
            if ($x = self::first($inner, 'ed_lead')) $sec['lead'] = trim($x[1]);
            if ($x = self::first($inner, 'ed_currency')) $sec['currency_text'] = self::paragraphs($x[1]);
            foreach (self::items($inner, 'ed_text') as [, $t]) $sec['text'] = array_merge($sec['text'], self::paragraphs($t));
            foreach (self::items($inner, 'ed_update') as [$ia, $t]) {
                $dir = strtolower($ia['dir'] ?? 'flat');
                $sec['updates'][] = [isset(ED_Calc::ARROW[$dir]) ? $dir : 'flat', trim($t)];
            }
            foreach (self::items($inner, 'ed_fig') as [$ia, $note]) {
                $f = ['label' => self::att($ia['label'] ?? ''), 'value' => self::att($ia['value'] ?? ''), 'unit' => self::att($ia['unit'] ?? ''), 'code' => strtoupper($ia['code'] ?? ''), 'note' => trim($note), 'decimals' => (int) ($ia['decimals'] ?? 0), 'scale' => $ia['scale'] ?? '', 'trend' => null];
                if (!empty($ia['trend'])) {
                    $p = array_map('trim', explode('|', self::att($ia['trend'])));
                    $f['trend'] = ['dir' => $p[0] ?? 'flat', 'change' => $p[1] ?? '', 'short' => $p[2] ?? 'flat', 'long' => $p[3] ?? 'flat', 'when' => $p[4] ?? ''];
                    foreach (['dir', 'short', 'long'] as $k) if (!isset(ED_Calc::ARROW[$f['trend'][$k]])) $f['trend'][$k] = 'flat';
                }
                $sec['figs'][] = $f;
            }
            foreach (self::items($inner, 'ed_charts') as [$ca, $cinner]) {
                foreach (self::selfClosing($cinner, 'ed_chart') as $ch) if (!empty($ch['code'])) $sec['charts'][] = strtoupper($ch['code']);
                if (!empty($ca['codes'])) $sec['charts'] = array_merge(array_map('trim', explode(',', strtoupper($ca['codes']))), $sec['charts']);
            }
            $sec['charts'] = array_values(array_unique($sec['charts']));
            foreach (self::items($inner, 'ed_risk') as [$ra, $t]) {
                $watch = ($w = self::first($t, 'ed_watch')) ? trim($w[1]) : '';
                $t = preg_replace('/\[ed_watch\].*?\[\/ed_watch\]/s', '', $t);
                $lvl = strtolower($ra['level'] ?? 'medium');
                $sec['risks'][] = ['level' => in_array($lvl, ['high', 'medium', 'low'], true) ? $lvl : 'medium', 'title' => self::att($ra['title'] ?? ''), 'horizon' => self::att($ra['horizon'] ?? ''), 'text' => trim($t), 'watch' => $watch];
            }
            if ($x = self::first($inner, 'ed_gap')) $sec['gap'] = trim($x[1]);
            $r['sections'][] = $sec;
        }
        // every chart specification in the content, wherever it stands
        foreach (self::selfClosing($content, 'ed_chart') as $ch) {
            if (empty($ch['code'])) continue;
            $code = strtoupper($ch['code']);
            $series = [];
            foreach (array_filter(array_map('trim', explode(';', self::att($ch['series'] ?? '') ?: $code . ':' . self::att($ch['title'] ?? $code)))) as $item) {
                $p = array_map('trim', explode(':', $item));
                $s = ['name' => $p[1] ?? $p[0], 'code' => strtoupper($p[0])];
                if (isset($p[2]) && $p[2] !== '') $s['scale'] = (float) $p[2];
                $series[] = $s;
            }
            $spec = ['title' => self::att($ch['title'] ?? $code), 'unit' => self::att($ch['unit'] ?? ''), 'decimals' => (int) ($ch['decimals'] ?? 0), 'series' => $series];
            if (isset($ch['tick']) && $ch['tick'] !== '') $spec['tickDecimals'] = (int) $ch['tick'];
            if (($ch['zero'] ?? '') === '1') $spec['zero'] = true;
            if (($ch['step'] ?? '') === '1') $spec['step'] = true;
            $r['charts'][$code] = $spec;
        }
        foreach (self::items($content, 'ed_fact') as [$fa, $t]) $r['facts'][] = [self::att($fa['label'] ?? ''), trim($t)];
        if ($x = self::first($content, 'ed_sources')) {
            foreach (preg_split('/\r?\n/', $x[1]) as $line) { $line = trim($line); if ($line !== '') $r['sources'][] = preg_replace('/^<li[^>]*>|<\/li>$/i', '', $line); }
        }
        return $r;
    }
}
