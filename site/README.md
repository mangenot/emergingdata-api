# EmergingData country pages

The generator of the country report pages (the November 2026 edition: Bangladesh, Cambodia, Honduras, Kenya, Pakistan).
Each page is one self-contained HTML file published as a claude.ai artifact, with a printable copy and a PDF.

    python3 build_pages.py --fetch            pull the database, then build the five pages
    python3 build_pages.py KHM HND            build from the data files on disk
    python3 fetch_data.py [ISO ...]           the pull alone (needs network access to the API)
    node pdf.js Cambodia                      the PDF of a built page (Playwright, A4, print styles)

## Files

- `build_pages.py`: the renderer. Reads `specs/<iso>.py` and `data/`, writes `<iso>-profile.html` (the artifact page)
  and `dist/<Name>-Apparel-Profile-2026-11.html` (standalone). Computes the trend tiles, the currency block (nominal
  and real moves, the wage in dollars), the real exchange rate chart, and fills the scores and benchmark from the fetch.
- `fetch_data.py`: pulls from the EmergingData API (`ED_API_BASE`, default emergingdata-api.vercel.app; `ED_API_KEY`
  optional) every series of a country (`data/<ISO>_series.txt`), the text-valued indicators (`data/<ISO>_facts.json`),
  the latest scores with the engine's inputs (`data/<ISO>_scores.json`), the benchmark (`data/bench.json`) and a
  record of the fetch (`data/fetch_meta.json`). Requests go eight indicators at a time (the database answers at most
  1,000 rows per request); the current month of the GDELT counts is left out as incomplete.
- `data/overrides/<ISO>_series.txt`: hand corrections in the same format, merged on top of the fetched series at
  build time, so a fetch never loses them. Each line should carry a comment on its source and reason.
- `specs/<iso>.py`: the page content. Overview (standfirst, paragraphs with subheadings, byline), the currency block
  text and rate, the five sections in the editor's order (FIN, EXT, POL, LOG, ENE) with lead, text (one sentence per
  item), updates (direction, text), tiles (value and note by hand; trend from a series `code` or by hand), risks,
  charts and the "to add" line; then standing facts, chart definitions, events and sources. `{series}` in `meta` is
  filled with the fetch date and series count. The word "pilot" must not appear on a page.
- `template.css`, `template.js`: inlined in every page (charts, benchmark and scores tables).
- `recover.py`, `compare.py`: rebuild a spec from a published page, and compare a build with the published version.
- `data/snapshot_2026-11-04/`: the series as first pulled, kept for reference.

## Workflow of an edition

1. `python3 build_pages.py --fetch`: the build prints the tiles whose series moved since the previous build
   (`data/last_build.json` remembers what each build saw).
2. Update the hand-written values and sentences next to them in the specs.
3. Build again, look at the page, publish it to its artifact URL, make the PDF.

## Daily refresh

A scheduled task runs every morning after the nightly sheet push: `build_pages.py --fetch`, republish of the five
artifacts (computed parts only: trends, currency block, charts, scores, benchmark), commit of `data/`, and a report of
the tiles whose series moved. The text of a page changes only when an edition is rewritten.

## Artifacts

Bangladesh RXryA7NFv8Med9mzbeZR7h, Kenya AFL3XQPs7J4f2unC6eztES, Pakistan VuWvm6D4zJdDW17u61LWF3,
Cambodia 3i9pKA642Ey6tHrDKQrPyv, Honduras 92k4JxmUbqumzvWPfv1gK5 (https://claude.ai/artifact/<id>).
