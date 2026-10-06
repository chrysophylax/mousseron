// Self-contained export representations of mash-ups.
import { MODES } from './generate.js';
import { VERSION } from './version.js';

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
    ...(lang && { language: { id: lang.id, name: lang.name, family: lang.family } }),
    ...(entry.fallback && { fallback: 'weighted' }),
  };
}

export function toExportObject(mashup, features, languages) {
  return {
    id: mashup.id,
    lineageId: mashup.lineageId,
    parentId: mashup.parentId,
    iteration: mashup.iteration,
    name: mashup.name,
    createdAt: mashup.createdAt,
    mode: mashup.mode,
    poolSize: mashup.poolSize,
    pool: mashup.pool.map((id) => ({ id, name: languages.get(id)?.name ?? id })),
    entries: mashup.entries.map((e) => resolveEntry(e, features, languages)),
  };
}

export function toJson(mashups, features, languages, dataset) {
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
      mashups: mashups.map((m) => toExportObject(m, features, languages)),
    },
    null,
    2,
  );
}

export function toText(mashup, features, languages) {
  const lines = [
    `${mashup.name} — iteration ${mashup.iteration}`,
    `Mode: ${MODES[mashup.mode]}`,
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
    if (r.fallback) line += ' [weighted fallback]';
    if (r.locked) line += ' [locked]';
    lines.push(line);
  }
  lines.push('', `Generated with Mousseron ${VERSION} from Grambank v1.0.3 (CC-BY-4.0).`);
  return lines.join('\n');
}
