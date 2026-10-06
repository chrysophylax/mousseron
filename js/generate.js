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

export function weightedValue(feature, rng) {
  const total = feature.codes.reduce((s, c) => s + (feature.frequency[c.value] || 0), 0);
  if (!total) return uniformValue(feature, rng);
  let r = rng() * total;
  for (const c of feature.codes) {
    r -= feature.frequency[c.value] || 0;
    if (r < 0) return c.value;
  }
  return feature.codes[feature.codes.length - 1].value;
}

// Produces entries for featureIds. Entries in `locked` (Map featureId -> entry) are kept.
export function roll({ featureIds, features, languages, mode, poolSize = 3, locked = new Map(), rng = Math.random }) {
  const pool = mode === 'mix' ? sample(languages, poolSize, rng) : [];
  const entries = featureIds.map((id) => {
    if (locked.has(id)) return { ...locked.get(id), locked: true };
    const feature = features.get(id);
    if (mode === 'uniform') return { featureId: id, value: uniformValue(feature, rng), locked: false };
    if (mode === 'weighted') return { featureId: id, value: weightedValue(feature, rng), locked: false };
    const donors = pool.filter((l) => id in l.values);
    if (!donors.length) {
      // No pool language is coded for this feature.
      return { featureId: id, value: weightedValue(feature, rng), locked: false, fallback: true };
    }
    const donor = pick(donors, rng);
    return { featureId: id, value: donor.values[id], locked: false, languageId: donor.id };
  });
  return { mode, poolSize: mode === 'mix' ? poolSize : null, pool: pool.map((l) => l.id), entries };
}
