// Downloads the Grambank CLDF release from Zenodo and converts it for IndexedDB.
import { recordParser, parseCsv } from './csv.js';
import { listEntries, findEntry, entryText, entryTextStream, iterate } from './zip.js';

export const DATASET = {
  name: 'Grambank',
  version: 'v1.0.3',
  doi: '10.5281/zenodo.7844558',
  url: 'https://zenodo.org/api/records/7844558/files/grambank/grambank-v1.0.3.zip/content',
  homepage: 'https://grambank.clld.org/',
  license: 'CC-BY-4.0',
  citation:
    'Skirgård, Hedvig et al. 2023. Grambank v1.0.3 (v1.0.3) [Data set]. Zenodo. ' +
    'https://doi.org/10.5281/zenodo.7844558',
};

// Grambank's theoretical score groupings (parameters.csv columns).
export const GROUPS = {
  Word_Order: 'Word order',
  Gender_or_Noun_Class: 'Gender / noun class',
  Locus_of_Marking: 'Locus of marking',
  Boundness: 'Boundness (fusion)',
  Flexivity: 'Flexivity',
};

export async function download(onProgress = () => {}) {
  const res = await fetch(DATASET.url);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get('Content-Length')) || 0;
  const parts = [];
  let loaded = 0;
  for await (const part of iterate(res.body)) {
    parts.push(part);
    loaded += part.byteLength;
    onProgress(loaded, total);
  }
  return new Blob(parts).arrayBuffer();
}

export async function importArchive(buffer, onStep = () => {}) {
  const entries = listEntries(buffer);
  const csv = (name) => entryText(buffer, findEntry(entries, `/cldf/${name}`)).then(parseCsv);

  onStep('Reading features');
  const [params, codes, langs] = await Promise.all([
    csv('parameters.csv'),
    csv('codes.csv'),
    csv('languages.csv'),
  ]);

  const features = new Map();
  params.forEach((p, order) => {
    features.set(p.ID, {
      id: p.ID,
      order,
      name: p.Name,
      description: p.Description,
      groups: Object.keys(GROUPS).filter((g) => p[g]),
      codes: [],
      frequency: {},
    });
  });
  for (const c of codes) {
    const f = features.get(c.Parameter_ID);
    if (!f) continue;
    f.codes.push({ value: c.Name, label: c.Description });
    f.frequency[c.Name] = 0;
  }

  const languages = new Map();
  for (const l of langs) {
    languages.set(l.ID, {
      id: l.ID,
      name: l.Name,
      family: l.Family_name,
      macroarea: l.Macroarea,
      values: {},
    });
  }

  onStep('Reading values');
  const parser = recordParser((v) => {
    if (v.Value === '?' || v.Value === '') return;
    const f = features.get(v.Parameter_ID);
    const l = languages.get(v.Language_ID);
    if (!f || !l || !(v.Value in f.frequency)) return;
    f.frequency[v.Value]++;
    l.values[v.Parameter_ID] = v.Value;
  });
  for await (const chunk of iterate(entryTextStream(buffer, findEntry(entries, '/cldf/values.csv')))) {
    parser.push(chunk);
  }
  parser.end();

  return {
    meta: { key: 'dataset', ...DATASET, importedAt: new Date().toISOString() },
    features: [...features.values()],
    languages: [...languages.values()].filter((l) => Object.keys(l.values).length),
  };
}
