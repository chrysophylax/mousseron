# Mousseron

A grammatical feature mash-up generator for conlanging, built on the
[Grambank](https://grambank.clld.org/) feature set (195 features).
Plain HTML5, CSS and JavaScript; runs entirely in the browser.

## Running

ES modules need to be served over HTTP, not opened from `file://`:

    python3 -m http.server 8000

Then open <http://localhost:8000/>.

On first load the Grambank v1.0.3 CLDF release (~9 MB) is downloaded from
[Zenodo](https://doi.org/10.5281/zenodo.7844558), unpacked in the browser and
stored in IndexedDB. Later visits work from the local copy.

## Use

1. Pick features in the list (search, filter by Grambank grouping).
2. Choose how values are picked:
   - **Uniform random**: every value equally likely.
   - **Weighted by world frequency**: proportional to Grambank language counts.
   - **Mix of real languages**: values come from a random pool of real languages.
   - **Weight by language family** (weighted and mix): each family counts
     equally, so large families don't dominate; isolates count as families.
     Mix pools then take each language from a different family.
3. Generate. Lock the features you like and reroll the rest; rerolls default
   to the iteration's own mode and family weighting, changeable with "Reroll with".

Every generation and reroll is saved as a new, immutable iteration in
IndexedDB. Mash-ups can be renamed from the Library; names must be unique, and
the current name is kept separately so saved iterations never change. Mash-ups can be copied as text and exported as JSON
(single iteration, all iterations, or the whole library).

## Feature rules

`rules/grambank.pl` encodes logical relations between Grambank features
(e.g. article placement requires an article). The page loads
[Tau Prolog](https://github.com/tau-prolog/tau-prolog) (vendored in
`vendor/tau-prolog/`) with `<script>` tags and evaluates the rules in the
browser. **Dataset validation** checks every Grambank language against them
(in the background after start-up, whenever the rules or dataset changed);
rules are classed as definitional, exhaustive, proxy or typological universal.
Each mash-up is checked too: violated rules are shown as warnings (and included
in exports) but never prevented, since resolving them can be part of the design.

## Data

Grambank is licensed under CC-BY-4.0. Skirgård, Hedvig et al. 2023.
Grambank v1.0.3 [Data set]. Zenodo. https://doi.org/10.5281/zenodo.7844558

## Versioning

[Semantic Versioning](https://semver.org/); releases are git tags `vX.Y.Z`.
The version is also set in `js/version.js`.
