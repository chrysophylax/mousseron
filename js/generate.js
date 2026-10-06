// Mash-up generation. Pure functions; rng is injectable for testing.
export const MODES = {
  uniform: 'Uniform random',
  weighted: 'Weighted by world frequency',
  mix: 'Mix of real languages',
};

function pick(list, rng) {
  return list[Math.floor(rng() * list.length)];
}

function sample(list, n, rng) {
  const copy = list.slice();
  const out = [];
  while (out.length < n && copy.length) {
    out.push(copy.splice(Math.floor(rng() * copy.length), 1)[0]);
  }
  return out;
}

export function uniformValue(feature, rng) {
  return pick(feature.codes, rng).value;
}

// Isolates have no family name and count as a family of their own.
const familyOf = (language) => language.family || language.id;

// Genealogically weighted counts: among the languages coded for the feature, each
// family weighs 1 in total, split evenly over its languages. Cached per language list.
const familyFrequencies = new WeakMap();

export function familyFrequency(feature, languages) {
  if (!familyFrequencies.has(languages)) familyFrequencies.set(languages, new Map());
  const cache = familyFrequencies.get(languages);
  if (!cache.has(feature.id)) {
    const coded = languages.filter((l) => feature.id in l.values);
    const sizes = new Map();
    for (const l of coded) sizes.set(familyOf(l), (sizes.get(familyOf(l)) ?? 0) + 1);
    const frequency = Object.fromEntries(feature.codes.map((c) => [c.value, 0]));
    for (const l of coded) frequency[l.values[feature.id]] += 1 / sizes.get(familyOf(l));
    cache.set(feature.id, frequency);
  }
  return cache.get(feature.id);
}

export function weightedValue(feature, rng, frequency = feature.frequency) {
  const total = feature.codes.reduce((s, c) => s + (frequency[c.value] || 0), 0);
  if (!total) return uniformValue(feature, rng);
  let r = rng() * total;
  for (const c of feature.codes) {
    r -= frequency[c.value] || 0;
    if (r < 0) return c.value;
  }
  return feature.codes[feature.codes.length - 1].value;
}

// A pool with each language from a different family, every family equally likely.
function familyPool(languages, n, rng) {
  const families = new Map();
  for (const l of languages) {
    if (!families.has(familyOf(l))) families.set(familyOf(l), []);
    families.get(familyOf(l)).push(l);
  }
  return sample([...families.values()], n, rng).map((list) => pick(list, rng));
}

// Produces entries for featureIds. Entries in `locked` (Map featureId -> entry) are kept,
// including the method that originally picked their value.
// genealogical: weight by language family instead of by language (weighted and mix modes).
export function roll({
  featureIds, features, languages, mode, poolSize = 3, genealogical = false, locked = new Map(), rng = Math.random,
}) {
  const byFamily = genealogical && mode !== 'uniform';
  const pool = mode !== 'mix' ? [] : byFamily ? familyPool(languages, poolSize, rng) : sample(languages, poolSize, rng);
  const weighted = (feature) =>
    weightedValue(feature, rng, byFamily ? familyFrequency(feature, languages) : feature.frequency);
  const flag = byFamily ? { genealogical: true } : {};
  const entries = featureIds.map((id) => {
    if (locked.has(id)) return { ...locked.get(id), locked: true };
    const feature = features.get(id);
    if (mode === 'uniform') return { featureId: id, value: uniformValue(feature, rng), locked: false, method: 'uniform' };
    if (mode === 'weighted') return { featureId: id, value: weighted(feature), locked: false, method: 'weighted', ...flag };
    const donors = pool.filter((l) => id in l.values);
    if (!donors.length) {
      // No pool language is coded for this feature.
      return { featureId: id, value: weighted(feature), locked: false, method: 'weighted', fallback: true, ...flag };
    }
    const donor = pick(donors, rng);
    return { featureId: id, value: donor.values[id], locked: false, method: 'mix', languageId: donor.id, ...flag };
  });
  return {
    mode,
    poolSize: mode === 'mix' ? poolSize : null,
    genealogical: byFamily,
    pool: pool.map((l) => l.id),
    entries,
  };
}
