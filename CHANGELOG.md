# Changelog

## 0.4.2 — 2026-10-06

- Copy as text waits for the rule check, so warnings are never left out.
- Errors after start-up show a dismissible alert instead of replacing the page;
  a failed dataset re-download keeps the app and the local copy.

## 0.4.1 — 2026-10-06

- Fix wrong rule results when checks overlapped (e.g. rerolling during
  validation): Prolog session access is now serialised.

## 0.4.0 — 2026-10-06

- Rule warnings on mash-ups: contradictions, likely conflicts and typologically
  unusual combinations are flagged, never prevented.
- Warnings included in copy-as-text and JSON exports.

## 0.3.0 — 2026-10-06

- Feature rules in Prolog (`rules/grambank.pl`), run in the browser with Tau Prolog.
- Dataset validation panel with per-rule report and JSON export.
- Removed Node tooling; everything runs in the web page.

## 0.2.0 — 2026-10-06

- Export button per library entry, exporting its latest iteration as JSON.
- Delete button gets a WCAG AA compliant danger border and hover colour.

## 0.1.0 — 2026-10-06

- Grambank v1.0.3 import from Zenodo into IndexedDB.
- Feature picker with search, Grambank grouping and selection filters.
- Uniform, frequency-weighted and real-language-mix generation.
- Lock and reroll, saved as immutable iterations.
- Copy as text; JSON export of iteration, lineage or library.
