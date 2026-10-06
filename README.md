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
3. Generate. Lock the features you like and reroll the rest.

Every generation and reroll is saved as a new, immutable iteration in
IndexedDB. Mash-ups can be copied as text and exported as JSON
(single iteration, all iterations, or the whole library).

## Tests

    node test/import.test.mjs path/to/grambank-v1.0.3.zip

## Data

Grambank is licensed under CC-BY-4.0. Skirgård, Hedvig et al. 2023.
Grambank v1.0.3 [Data set]. Zenodo. https://doi.org/10.5281/zenodo.7844558

## Versioning

[Semantic Versioning](https://semver.org/); releases are git tags `vX.Y.Z`.
The version is also set in `js/version.js` and `package.json`.
