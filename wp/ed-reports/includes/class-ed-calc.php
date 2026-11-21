<?php
/**
 * The arithmetic of the page, the same rules as the site generator: the trend of a tile (latest value against the
 * month, three and twelve months earlier), the currency tiles, the trade tiles, the one-line inputs behind a score.
 */
if (!defined('ABSPATH')) exit;

class ED_Calc {

    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    /** Codes whose changes are read in points, not per cent. */
    const RATE_CODES = ['INF_CPI', 'FIN_POLICY', 'FIN_CREDIT', 'FIN_NPL', 'FIN_LEND', 'FX_REAL_CHG'];
    const ARROW = ['up' => '&#9650;', 'flat' => '&#9654;', 'down' => '&#9660;'];
    const WORD = ['up' => 'rising', 'flat' => 'stable', 'down' => 'falling'];
    const DIR_ORDER = ['up' => 0, 'flat' => 1, 'down' => 2];
    const TREND_WORD = ['up' => 'up', 'down' => 'down', 'stable' => 'stable'];

    const SECTION_INPUT_LABELS = [
        ['next_election', 'election %s'], ['POL_SANCTIONS', 'sanctions %s'], ['POL_CPI_TI', 'corruption index %s'], ['POL_UNREST_ratio', 'unrest %s times the average'],
        ['main_market', 'main market %s'], ['TRD_TARIFF_US', 'US tariff %s%%'], ['TRD_TARIFF_EU', 'EU tariff %s%%'], ['TRD_DEST_US', 'US share %s%%'], ['TRD_DEST_EU', 'EU share %s%%'], ['next_pref_review', 'preference review %s'],
        ['EXT_RES_MOI', '%s months of imports'], ['EXT_RATING', 'rating %s'], ['EXT_IMF', 'IMF %s'],
        ['depreciation_12m', 'depreciation %s%%'], ['FX_VOL', 'volatility %s%%'], ['real_depreciation_12m', 'real depreciation %s%%'],
        ['INF_CPI', 'inflation %s%%'], ['INF_CPI_3m_avg', '3-month average %s'], ['rank_among_covered', 'rank %s of %d'],
        ['FIN_LEND', 'lending rate %s%%'], ['FIN_POLICY', 'policy rate %s%% plus 4'], ['FIN_NPL', 'NPL %s%%'],
        ['wage_usd', 'wage USD %s'], ['wage_usd_change_12m', 'up %s%% in USD'], ['next_wage_review', 'wage review %s'], ['LAB_STRIKES', 'strikes %s'],
        ['ENV_ELEC', 'electricity %s US c/kWh'], ['ENV_OUTAGE', 'outages %s h/month'],
    ];

    // ---------------------------------------------------------------- months and numbers
    public static function add_months(string $ym, int $n): string {
        $t = ((int) substr($ym, 0, 4)) * 12 + ((int) substr($ym, 5, 2)) - 1 + $n;
        return sprintf('%04d-%02d', intdiv($t, 12), $t % 12 + 1);
    }

    public static function months_between(string $a, string $b): int {
        return ((int) substr($b, 0, 4) - (int) substr($a, 0, 4)) * 12 + (int) substr($b, 5, 2) - (int) substr($a, 5, 2);
    }

    public static function month_label(?string $ym): string {
        if (!$ym || strlen($ym) < 7) return '';
        return self::MONTHS[(int) substr($ym, 5, 2) - 1] . ' ' . substr($ym, 0, 4);
    }

    public static function date_label(?string $iso): string {
        if (!$iso || strlen($iso) < 10) return '';
        return ((int) substr($iso, 8, 2)) . ' ' . self::MONTH_NAMES[(int) substr($iso, 5, 2) - 1] . ' ' . substr($iso, 0, 4);
    }

    /** '+1.2%' or '−0.4%' with the Unicode minus. */
    public static function signed(float $x, int $d = 1, string $unit = '%'): string {
        return ($x >= 0 ? '+' : "\u{2212}") . number_format(abs($x), $d, '.', '') . $unit;
    }

    public static function pct(float $x, int $d = 1): string {
        return self::signed($x, $d, '%');
    }

    public static function fmt($v, int $d = 0): string {
        if ($v === null || $v === '') return '&ndash;';
        return number_format((float) $v, $d, '.', ',');
    }

    public static function direction($d, bool $rate = false, ?float $thr = null): string {
        if ($d === null) return 'flat';
        $thr = $thr ?? ($rate ? 0.15 : 1.0);
        return abs($d) < $thr ? 'flat' : ($d > 0 ? 'up' : 'down');
    }

    /** The &minus; entity and a hyphen before a digit become the Unicode minus (for trend lines written by hand). */
    public static function minus(string $s): string {
        $s = str_replace('&minus;', "\u{2212}", $s);
        return preg_replace('/(?<![\w])-(?=\d)/u', "\u{2212}", $s);
    }

    // ---------------------------------------------------------------- series
    /** Value of a monthly series at or before the month, with the month found: [value, month] or [null, null]. */
    public static function series_at(array $S, string $code, string $ym): array {
        $s = $S[$code] ?? null;
        if (!$s || !isset($s['values'])) return [null, null];
        $vals = $s['values'];
        $i = min(self::months_between($s['start'], $ym), count($vals) - 1);
        while ($i >= 0 && $vals[$i] === null) $i--;
        return $i >= 0 ? [$vals[$i], self::add_months($s['start'], $i)] : [null, null];
    }

    /** Latest value of a series (monthly or points): [value, month]. */
    public static function series_last(array $S, string $code): array {
        $s = $S[$code] ?? null;
        if (!$s) return [null, null];
        if (isset($s['points'])) {
            $p = end($s['points']);
            return $p ? [$p[1], $p[0]] : [null, null];
        }
        for ($i = count($s['values']) - 1; $i >= 0; $i--) if ($s['values'][$i] !== null) return [$s['values'][$i], self::add_months($s['start'], $i)];
        return [null, null];
    }

    /**
     * Trend of a monthly series: change on the month, and direction over 3 and 12 months (latest against the value
     * three and twelve months earlier). Rates in points with a 0.15 point threshold, levels in per cent with 1%.
     */
    public static function series_trend(array $S, string $code): ?array {
        $s = $S[$code] ?? null;
        if (!$s || !isset($s['values'])) return null;
        $vals = $s['values'];
        $i = count($vals) - 1;
        while ($i >= 0 && $vals[$i] === null) $i--;
        if ($i < 0) return null;
        $rate = in_array($code, self::RATE_CODES, true);
        $now = $vals[$i];
        $chg = function ($a, $b) use ($rate) {
            if ($a === null || $b === null) return null;
            if ($rate) return $a - $b;
            return $b ? ($a / $b - 1) * 100 : null;
        };
        $mm = $chg($now, $i >= 1 ? $vals[$i - 1] : null);
        $d3 = $chg($now, $i >= 3 ? $vals[$i - 3] : null);
        $d12 = $chg($now, $i >= 12 ? $vals[$i - 12] : null);
        if ($mm === null) return null;
        return [
            'dir' => self::direction($mm, $rate), 'change' => self::signed($mm, 1, $rate ? ' pts' : '%') . ' on the month',
            'when' => self::month_label(self::add_months($s['start'], $i)),
            'short' => self::direction($d3, $rate), 'long' => self::direction($d12, $rate), 'labels' => ['3 m', '12 m'],
        ];
    }

    // ---------------------------------------------------------------- the currency block and the trade tiles
    /** The tiles of the currency block from the API's currency figures; the rate tile takes the hand value when given. */
    public static function currency_tiles(array $F, ?string $rate_value, ?string $rate_note): array {
        $figs = [];
        $when = self::month_label($F['when'] ?? '');
        $figs[] = ['label' => 'Exchange rate', 'value' => $rate_value !== null && $rate_value !== '' ? $rate_value : self::fmt($F['now'], 2),
                   'note' => $rate_note !== null && $rate_note !== '' ? $rate_note : esc_html($F['code'] . ' per USD, ' . $when), 'code' => 'FX_USD'];
        if (isset($F['dep12']) && $F['dep12'] !== null) {
            $figs[] = ['label' => 'Nominal move, 12 months', 'value' => self::pct($F['dep12']),
                       'note' => ($F['dep12'] >= 0 ? 'weaker' : 'stronger') . ' against the dollar, to ' . $when,
                       'trend' => ['dir' => self::direction($F['dep12'], false, 0.5), 'change' => isset($F['dep1']) && $F['dep1'] !== null ? self::pct($F['dep1']) . ' on the month' : '', 'short' => 'flat', 'long' => 'flat']];
        }
        if (isset($F['real_dep']) && $F['real_dep'] !== null) {
            $move = -$F['real_dep'];
            $figs[] = ['label' => 'Real move, 12 months', 'value' => self::pct($move),
                       'note' => ($move >= 0 ? 'dearer' : 'cheaper') . ' in dollars; local inflation ' . number_format($F['cpi'], 1) . '% against 3% in the US',
                       'trend' => ['dir' => self::direction($move, false, 0.5), 'change' => 'local costs in dollars, real terms', 'short' => 'flat', 'long' => 'flat']];
        }
        $w = $F['wage'] ?? null;
        if ($w && !empty($w['now'])) {
            $label = $w['label'] ?? 'minimum wage';
            $figs[] = ['label' => 'Minimum wage in dollars', 'value' => 'USD ' . self::fmt($w['now'], 0), 'unit' => 'a month',
                       'note' => esc_html(!empty($w['ago']) ? $label . '; USD ' . self::fmt($w['ago'], 0) . ' a year earlier' : $label),
                       'trend' => isset($w['chg']) && $w['chg'] !== null ? ['dir' => self::direction($w['chg'], false, 0.5), 'change' => self::pct($w['chg']) . ' on a year earlier', 'short' => 'flat', 'long' => 'up'] : null];
        }
        return $figs;
    }

    /** The two tiles of the trade section and its update line: [figs, [dir, text] or null]. */
    public static function trade_tiles(array $F): array {
        $figs = [];
        $update = null;
        if (isset($F['dep12']) && $F['dep12'] !== null) {
            $figs[] = ['label' => 'Import cost in local currency', 'value' => self::pct($F['dep12']), 'unit' => '12 m', 'note' => 'a dollar of inputs, nominal rate',
                       'trend' => ['dir' => self::direction($F['dep12'], false, 0.5), 'change' => 'to ' . self::month_label($F['when']), 'short' => 'flat', 'long' => 'flat']];
        }
        if (isset($F['real_dep']) && $F['real_dep'] !== null) {
            $move = -$F['real_dep'];
            $cpi = number_format($F['cpi'], 1);
            $figs[] = ['label' => 'Export cost in dollars', 'value' => self::pct($move), 'unit' => '12 m', 'note' => 'local costs in dollars, real rate',
                       'trend' => ['dir' => self::direction($move, false, 0.5), 'change' => 'local inflation ' . $cpi . '%', 'short' => 'flat', 'long' => 'flat']];
            $d = $F['dep12'];
            $ad = number_format(abs($d), 1);
            if (abs($d) < 0.5) $head = 'unchanged against the dollar';
            elseif ($d > 0) $head = "$ad% weaker against the dollar, so a dollar of imported inputs costs $ad% more in local currency";
            else $head = "$ad% stronger against the dollar, so a dollar of imported inputs costs $ad% less in local currency";
            $update = [self::direction($move, false, 0.5),
                       "The currency over twelve months: $head; with local inflation at $cpi%, local costs in dollars are " . number_format(abs($move), 1) . '% ' . ($move >= 0 ? 'higher' : 'lower') . ' in real terms.'];
        }
        return [$figs, $update];
    }

    // ---------------------------------------------------------------- scores
    /** A short line of the inputs behind a section score, from the engine's inputs and notes. */
    public static function section_note(array $sec, int $covered): string {
        $inputs = $sec['inputs'] ?? [];
        $parts = [];
        if (is_array($inputs)) {
            foreach (self::SECTION_INPUT_LABELS as [$key, $label]) {
                if (!array_key_exists($key, $inputs) || $inputs[$key] === null) continue;
                $v = $inputs[$key];
                if (is_float($v)) $v = rtrim(rtrim(number_format(round($v, 2), 2, '.', ''), '0'), '.');
                elseif (is_string($v) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) $v = ((int) substr($v, 8, 2)) . ' ' . self::MONTHS[(int) substr($v, 5, 2) - 1] . ' ' . substr($v, 0, 4);
                elseif (is_string($v) && mb_strlen($v) > 70) $v = rtrim(mb_substr($v, 0, 67)) . '...';
                $text = $key === 'rank_among_covered' ? sprintf($label, $v, $covered) : sprintf($label, $v);
                $parts[] = str_replace([' -', '(-'], [" \u{2212}", "(\u{2212}"], $text);
            }
        }
        if (!$parts) {
            $notes = $sec['notes'] ?? [];
            if (is_array($notes)) foreach (array_slice($notes, 0, 2) as $n) $parts[] = strtok((string) $n, ':');
            if (!$parts) $parts = ['no series loaded'];
        }
        return implode('; ', $parts);
    }

    /** The SCORES block of the page in the shape the script expects. */
    public static function scores_block(?array $sc, int $covered): ?array {
        if (!$sc) return null;
        $sections = [];
        foreach ($sc['sections'] ?? [] as $s) {
            if (($s['section'] ?? '') === 'GLB') continue;   // the global drivers are not a country score
            $sections[] = [$s['section'], $s['name'], $s['cost'], self::TREND_WORD[$s['cost_trend'] ?? ''] ?? 'stable', $s['risk'], self::TREND_WORD[$s['risk_trend'] ?? ''] ?? 'stable', self::section_note($s, $covered)];
        }
        $cd = $sc['composite_detail'] ?? null;
        $cov = '';
        if (is_array($cd)) {
            $part = function ($p, $label) use ($cd) {
                $d = $cd[$p] ?? [];
                $covered = $d['covered'] ?? null;
                $pct = is_numeric($covered) ? ($covered <= 1 ? round($covered * 100) : round($covered)) . '%' : '';
                $miss = $d['missing'] ?? [];
                return "$label $pct of the weight" . ($miss ? ' (missing ' . implode(', ', $miss) . ')' : '');
            };
            $cov = 'Composite coverage: ' . $part('cost', 'cost') . ', ' . $part('risk', 'risk') . '; the covered components are renormalised.';
        }
        return ['cost' => $sc['cost_pressure'], 'costT' => self::TREND_WORD[$sc['cost_trend'] ?? ''] ?? 'stable', 'risk' => $sc['disruption_risk'], 'riskT' => self::TREND_WORD[$sc['risk_trend'] ?? ''] ?? 'stable',
                'sections' => $sections, 'cov' => $cov, 'date' => $sc['score_date'] ?? null];
    }
}
