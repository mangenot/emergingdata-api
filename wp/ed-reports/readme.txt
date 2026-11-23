=== ED Reports ===
Contributors: emergingtextiles
Requires at least: 6.5
Tested up to: 7.2
Requires PHP: 8.0
Stable tag: 1.0.1
License: Proprietary

Country reports for EmergingData: the text is written in the editor with shortcodes; the figures, tiles, charts, benchmark table and scores are filled from the EmergingData API when the page is displayed.

== How it works ==

1. Settings > ED Reports: the API base (https://emergingdata-api.vercel.app), the client key if the API requires one, the cache (minutes), and the texts shared by every report (the global block, the benchmark note, the scores line, the method points, the footer).
2. Country reports > Add report: the title is the country name; in the Report box, the country code (HND), the subtitle, the edition and the series line. The text goes in the editor (Text tab), with the shortcodes below. The classic editor is used for this post type, and nothing in the content is rewritten (no automatic paragraphs, no typographic quotes).
3. The page: the plugin's template wraps the report in the theme's header and footer, without sidebar. The report's stylesheet and script are the ones of the prototype pages, scoped to the report. A Print button prints the report on A4 (light palette, nothing split across pages).
4. Access: when Paid Memberships Pro is active, its rule for the post decides who sees the body of the report; the figures sent to the browser (series, scores, benchmark) follow the same rule. Editors always see everything.
5. Data: one API call per country (/api/page-data), cached for the number of minutes set; the last good answer is kept and used if the API does not answer. "Clear the API cache" on the settings page forces a new call.

The computed parts use the same rules as the prototype pages: a tile with a code shows the change on the month and the direction over three and twelve months (rates in points with a 0.15 point threshold, levels in per cent with 1%); the currency block shows the rate, the nominal and real twelve-month moves and the wage in dollars; the trade section opens with the import cost in local currency and the export cost in dollars, and its first update line says the same in words; the benchmark table lists every scored country ordered by cost pressure; the scores table shows the engine's section scores with a line of its inputs.

== Shortcodes ==

[ed_overview date="21 November 2026"]
  [ed_standfirst]The summary in bold.[/ed_standfirst]
  <h3>A heading</h3>
  <p>Paragraphs as plain HTML.</p>
  [ed_byline]Sources and date line.[/ed_byline]
[/ed_overview]

[ed_global]                                 the shared block, from the settings (Label|text lines)

[ed_section key="FIN"]                      keys: FIN, EXT, POL, LOG, ENE (title="..." short="..." for another section)
  [ed_lead]The conclusion in bold.[/ed_lead]
  [ed_currency then="Public finances and the banks" rate="26.91" rate_note="HNL per USD, 20 Nov 2026 (BCH reference)"]
  One sentence per line.
  [/ed_currency]                            the currency block: text, four computed tiles, two charts, then the heading given by then=
  [ed_chart code="FX_USD" title="Exchange rate" unit="HNL per USD, monthly average of the BCH reference rate" decimals="2" tick="0"]
                                            optional: the wording of the exchange rate chart (the plugin has a default)
  [ed_text]
  One sentence per line.

  A blank line starts a new paragraph.
  [/ed_text]
  [ed_updates]
    [ed_update dir="up"]...[/ed_update]      dir: up, flat, down; sorted up, flat, down; in the EXT section the currency line comes first (trade="0" to omit it)
  [/ed_updates]
  [ed_figs]                                 in the EXT section the two trade tiles come first (trade="0" to omit them)
    [ed_fig label="Reserves" value="USD 11.6 bn" code="EXT_RES"]22 Oct 2026; 6.7 months of imports (BCH)[/ed_fig]
    [ed_fig label="Growth" value="3.4%" unit="2026" trend="down|-0.4 pts on 2025|down|flat"]IMF[/ed_fig]
    [ed_fig label="Policy rate" value="auto" code="FIN_POLICY" decimals="2" unit="%"][/ed_fig]
  [/ed_figs]
      value: the figure as written; code: the series whose trend is shown under the tile; value="auto": the latest value of the series
      (decimals, scale); trend="dir|change|short|long|when": a trend written by hand
  [ed_charts]
    [ed_chart code="EXT_RES" title="Reserves" unit="USD billion, end of month" decimals="1" tick="0" series="EXT_RES:Reserves:0.001"]
    [ed_chart code="TRD" title="Goods trade" unit="USD billion a month" decimals="2" zero="1" series="TRD_EXP:Exports:0.001;TRD_IMP:Imports:0.001"]
  [/ed_charts]
      series: CODE:Name:scale, several separated by ;  tick: decimals of the axis labels; zero="1" starts the axis at zero; step="1" draws steps
  [ed_risks]
    [ed_risk level="high" title="Inflation above the band" horizon="to mid-2027"]Text.[ed_watch]What to watch.[/ed_watch][/ed_risk]
  [/ed_risks]
  [ed_gap]the indicators not loaded yet[/ed_gap]
[/ed_section]

[ed_facts]
  [ed_fact label="Trade preferences"]CAFTA-DR ...[/ed_fact]
[/ed_facts]
[ed_benchmark]                              lede="..." foot="..." to replace the texts
[ed_scores]                                 lede="..." to replace the text ({score_date} is filled)
[ed_method]
  [ed_sources]
  One source per line.
  [/ed_sources]
[/ed_method]

Placeholders filled from the API in the series line, the footer and the ledes: {series} (date and number of series), {fetched}, {name}, {score_date}, {score_month}.

== Changelog ==

= 1.0.1 =
The publishing script can log in through the X-ED-Authorization header on servers that drop the standard Authorization header (Apache with PHP-FPM).

= 1.0.0 =
First version: post type, shortcodes, template, settings, API cache, print styles.
