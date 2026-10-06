// Feature rules (rules/grambank.pl) evaluated with Tau Prolog, loaded as
// classic <script> tags that define the global `pl`.
const atom = (id) => id.toLowerCase();

export const KINDS = {
  definitional: 'Definitional: the coding manual makes a violation a contradiction.',
  exhaustive: 'Exhaustive: the features jointly cover every logical possibility.',
  proxy: 'Proxy: a contradiction unless the system is of a kind no feature covers.',
  universal: 'Typological universal: violations are rare but legitimate.',
};

// Feature pairs that may legitimately both be 1; reported for reference.
export const BOTH_ALLOWED = [
  ['GB022', 'GB023'], ['GB074', 'GB075'], ['GB079', 'GB080'], ['GB089', 'GB090'],
  ['GB091', 'GB092'], ['GB093', 'GB094'], ['GB137', 'GB138'], ['GB262', 'GB263'],
  ['GB327', 'GB328'], ['GB421', 'GB422'], ['GB408', 'GB409'],
];

function prolog() {
  if (!globalThis.pl) throw new Error('Tau Prolog is not loaded');
  return globalThis.pl;
}

function consult(session, text) {
  return new Promise((resolve, reject) =>
    session.consult(text, { success: resolve, error: (e) => reject(new Error(prolog().format_answer(e))) }));
}

function answers(session, goal) {
  return new Promise((resolve, reject) => {
    const out = [];
    const fail = (e) => reject(new Error(`${goal.slice(0, 80)}: ${prolog().format_answer(e)}`));
    const next = () =>
      session.answer({
        success(a) { out.push(a); next(); },
        fail() { resolve(out); },
        error: fail,
        limit: () => reject(new Error('Prolog inference limit reached')),
      });
    session.query(goal, { success: next, error: fail });
  });
}

const show = (a, name) => a.links[name].toString();

export function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}

export async function loadRules(features) {
  const res = await fetch('rules/grambank.pl');
  if (!res.ok) throw new Error(`Could not load rules: HTTP ${res.status}`);
  const source = await res.text();
  const session = prolog().create(1000000);
  const vocabulary = features
    .flatMap((f) => [`feature(${atom(f.id)}).`, ...f.codes.map((c) => `code(${atom(f.id)}, ${c.value}).`)])
    .join('\n');
  await consult(session, `${source}\n${vocabulary}`);

  const problems = await answers(session, 'bad_rule(Id, Why).');
  if (problems.length) {
    throw new Error(`Invalid rules: ${problems.map((a) => `${show(a, 'Id')} (${show(a, 'Why')})`).join(', ')}`);
  }
  const constraints = (await answers(session, 'constraint(Id, Kind, _, _, Text).')).map((a) => ({
    id: show(a, 'Id'),
    kind: show(a, 'Kind'),
    text: a.links.Text.id,
  }));
  const used = new Set((await answers(session, 'rule_feature(_, F).')).map((a) => show(a, 'F')));

  // profiles: [{id, values}] with values mapping GBxxx -> '0'..'3'.
  // Returns Map(profile id -> [{id, status}]) for every applicable rule.
  // Each Tau query costs a scheduling round trip, so a whole batch is one query.
  async function evaluateMany(profiles) {
    const facts = profiles.map((p, i) => {
      const pairs = Object.entries(p.values)
        .filter(([f, v]) => v !== '?' && used.has(atom(f)))
        .map(([f, v]) => `${atom(f)}-${v}`);
      return `profile(${i}, [${pairs.join(', ')}]).`;
    });
    await consult(session, `:- dynamic(profile/2).\n${facts.join('\n')}`);
    const [a] = await answers(session, 'findall(P-Id-S, check(P, Id, S), Results).');
    const out = new Map(profiles.map((p) => [p.id, []]));
    for (let t = a.links.Results; t.indicator === './2'; t = t.args[1]) {
      const [pid, rule] = t.args[0].args[0].args;
      out.get(profiles[pid.value].id).push({ id: rule.id, status: t.args[0].args[1].id });
    }
    return out;
  }

  const evaluate = async (values) => (await evaluateMany([{ id: 'profile', values }])).get('profile');

  return { source, version: hash(source), constraints, evaluate, evaluateMany };
}

export async function validateDataset(engine, languages, onProgress = () => {}) {
  const started = performance.now();
  const rules = engine.constraints.map((c) => ({ ...c, violated: [], satisfied: 0, undetermined: 0 }));
  const byId = new Map(rules.map((r) => [r.id, r]));
  const BATCH = 25;
  for (let i = 0; i < languages.length; i += BATCH) {
    onProgress(i, languages.length);
    const results = await engine.evaluateMany(languages.slice(i, i + BATCH));
    for (const [langId, statuses] of results) {
      for (const { id, status } of statuses) {
        const rule = byId.get(id);
        if (status === 'violated') rule.violated.push(langId);
        else rule[status]++;
      }
    }
  }
  const pairs = BOTH_ALLOWED.map(([a, b]) => {
    const coded = languages.filter((l) => a in l.values && b in l.values);
    return { features: [a, b], both: coded.filter((l) => l.values[a] === '1' && l.values[b] === '1').length, coded: coded.length };
  });
  return {
    key: 'validation',
    rulesVersion: engine.version,
    createdAt: new Date().toISOString(),
    seconds: Math.round((performance.now() - started) / 100) / 10,
    languages: languages.length,
    rules,
    pairs,
  };
}
