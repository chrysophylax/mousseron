// Self-contained export representations of mash-ups.
import { MODES } from './generate.js';
import { VERSION } from './version.js';
import { SEVERITY } from './rules.js';

function resolveWarnings(mashup, conflicts) {
  const present = new Set(mashup.entries.map((e) => e.featureId));
  return conflicts.map((c) => ({
    rule: c.id,
    severity: SEVERITY[c.kind],
    kind: c.kind,
    description: c.text,
    features: c.features.filter((f) => present.has(f)),
  }));
}

function resolveEntry(entry, features, languages) {
  const f = features.get(entry.featureId);
  const code = f?.codes.find((c) => c.value === entry.value);
  const lang = entry.languageId ? languages.get(entry.languageId) : null;
  return {
    featureId: entry.featureId,
    feature: f?.name ?? '',
    value: entry.value,
    label: code?.label ?? '',
    locked: entry.locked,
    ...(entry.method && { method: entry.method }),
    ...(entry.genealogical && { genealogical: true }),
    ...(lang && { language: { id: lang.id, name: lang.name, family: lang.family } }),
    ...(entry.fallback && { fallback: 'weighted' }),
  };
}

export function toExportObject(mashup, features, languages, conflicts = []) {
  return {
    id: mashup.id,
    lineageId: mashup.lineageId,
    parentId: mashup.parentId,
    ...(mashup.derivation && { derivation: mashup.derivation }),
    iteration: mashup.iteration,
    name: mashup.name,
    createdAt: mashup.createdAt,
    mode: mashup.mode,
    poolSize: mashup.poolSize,
    genealogical: mashup.genealogical === true,
    pool: mashup.pool.map((id) => ({ id, name: languages.get(id)?.name ?? id })),
    entries: mashup.entries.map((e) => resolveEntry(e, features, languages)),
    warnings: resolveWarnings(mashup, conflicts),
  };
}

// conflicts: Map(mashup id -> violated rules), as returned by the rules engine.
export function toJson(mashups, features, languages, dataset, conflicts = new Map()) {
  return JSON.stringify(
    {
      generator: `Mousseron ${VERSION}`,
      exportedAt: new Date().toISOString(),
      dataset: dataset && {
        name: dataset.name,
        version: dataset.version,
        doi: dataset.doi,
        license: dataset.license,
        citation: dataset.citation,
      },
      mashups: mashups.map((m) => toExportObject(m, features, languages, conflicts.get(m.id))),
    },
    null,
    2,
  );
}

export function toText(mashup, features, languages, conflicts = []) {
  const lines = [
    `${mashup.name} — iteration ${mashup.iteration}`,
    `Mode: ${MODES[mashup.mode]}${mashup.genealogical ? ', by language family' : ''}`,
  ];
  const donors = [...new Set(mashup.entries.map((e) => e.languageId).filter(Boolean))];
  if (donors.length) {
    lines.push(`Languages: ${donors.map((id) => languages.get(id)?.name ?? id).join(', ')}`);
  }
  lines.push('');
  for (const e of mashup.entries) {
    const r = resolveEntry(e, features, languages);
    let line = `${r.featureId} ${r.feature} → ${r.value} (${r.label})`;
    if (r.language) line += ` [${r.language.name}]`;
    const byFamily = r.genealogical ? ', by family' : '';
    if (r.fallback) line += ` [weighted fallback${byFamily}]`;
    else if (r.method && r.method !== 'mix'
      && (r.method !== mashup.mode || !!r.genealogical !== !!mashup.genealogical)) line += ` [${r.method}${byFamily}]`;
    if (r.locked) line += ' [locked]';
    lines.push(line);
  }
  const warnings = resolveWarnings(mashup, conflicts);
  if (warnings.length) {
    lines.push('', 'Rule warnings:');
    for (const w of warnings) lines.push(`- ${w.severity}: ${w.description} (${w.features.join(', ')})`);
  }
  lines.push('', `Generated with Mousseron ${VERSION} from Grambank v1.0.3 (CC-BY-4.0).`);
  return lines.join('\n');
}
