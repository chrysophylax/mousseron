import * as db from './db.js';
import { DATASET, GROUPS, download, importArchive } from './grambank.js';
import { MODES, roll } from './generate.js';
import { toJson, toText } from './format.js';
import { render as renderMarkdown } from './markdown.js';
import { KINDS, SEVERITY, loadRules, validateDataset } from './rules.js';
import { VERSION } from './version.js';

const MODE_HELP = {
  uniform: 'Every value of a feature is equally likely.',
  weighted: 'Values are picked in proportion to how often they occur among Grambank languages.',
  mix: 'A pool of real languages is drawn at random; each feature takes its value from one of them.',
};
// Appended to the mode help when weighting by language family.
const GENEALOGICAL_HELP = {
  weighted: 'Each language family counts equally, so large families do not dominate; isolates count as families.',
  mix: 'Pool languages come from different families, each family equally likely; isolates count as families.',
};
const POOL_SIZES = [2, 3, 4, 5, 6, 8, 10, 12];

const $ = (id) => document.getElementById(id);

const state = {
  dataset: null,
  features: new Map(),
  featureList: [],
  languages: new Map(),
  languageList: [],
  selection: new Set(),
  mashups: [],
  current: null,
  locks: new Set(),
  rules: null,
  rulesReady: null,
  validation: null,
  conflicts: [],
  conflictChecks: new Map(),
  sort: { key: 'feature', dir: 'asc' },
  names: new Map(),
  renaming: null,
};

// ---------- helpers ----------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

const storage = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`mousseron:${key}`);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`mousseron:${key}`, JSON.stringify(value));
    } catch {
      // Storage unavailable (private mode etc.); preferences are optional.
    }
  },
};

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const x = [...b].map((n) => n.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const formatDate = (iso) => dateFormat.format(new Date(iso));

let toastTimer;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 3000);
}

function slug(s) {
  return s.toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'mashup';
}

function downloadFile(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// text may be a promise. ClipboardItem accepts a pending value, so the write
// starts inside the click; awaiting first can lose user activation (Safari).
async function copyText(text) {
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      const blob = Promise.resolve(text).then((t) => new Blob([t], { type: 'text/plain' }));
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
    } else {
      await navigator.clipboard.writeText(await text);
    }
  } catch {
    text = await text;
    const ta = h('textarea', { readonly: true, style: 'position:fixed;opacity:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) throw new Error('Clipboard unavailable');
  }
}

// ---------- dataset ----------

function showLoader(text, { progress = null, error = false } = {}) {
  $('loader').hidden = false;
  $('loader').classList.toggle('is-error', error);
  $('loader-text').textContent = text;
  const bar = $('loader-progress');
  bar.hidden = error;
  if (progress == null) bar.removeAttribute('value');
  else bar.value = progress;
  $('loader-retry').hidden = !error;
}

async function fetchDataset() {
  const mb = (n) => (n / 1048576).toFixed(1);
  showLoader(`Downloading ${DATASET.name} ${DATASET.version} from Zenodo…`);
  const buffer = await download((loaded, total) => {
    showLoader(
      `Downloading ${DATASET.name} ${DATASET.version} from Zenodo… ${mb(loaded)}${total ? ` / ${mb(total)}` : ''} MB`,
      { progress: total ? loaded / total : null },
    );
  });
  const data = await importArchive(buffer, (step) => showLoader(`${step}…`));
  showLoader('Saving to local database…');
  await db.replaceDataset(data);
}

async function loadData() {
  state.dataset = await db.get('meta', 'dataset');
  state.featureList = (await db.getAll('features')).sort((a, b) => a.order - b.order);
  state.features = new Map(state.featureList.map((f) => [f.id, f]));
  state.languageList = await db.getAll('languages');
  state.languages = new Map(state.languageList.map((l) => [l.id, l]));
  state.mashups = await db.getAll('mashups');
  state.names = new Map((await db.getAll('names')).map((n) => [n.lineageId, n.name]));
  state.validation = (await db.get('meta', 'validation')) ?? null;
}

// ---------- feature picker ----------

function buildPicker() {
  const groupSelect = $('feature-group');
  groupSelect.replaceChildren(h('option', { value: '' }, `All features (${state.featureList.length})`));
  for (const [key, label] of Object.entries(GROUPS)) {
    const n = state.featureList.filter((f) => f.groups.includes(key)).length;
    groupSelect.append(h('option', { value: key }, `${label} (${n})`));
  }

  const list = $('feature-list');
  list.replaceChildren(
    ...state.featureList.map((f) =>
      h(
        'li',
        { 'data-id': f.id },
        h(
          'label',
          {},
          h('input', {
            type: 'checkbox',
            value: f.id,
            checked: state.selection.has(f.id),
            onchange: (e) => setSelected(f.id, e.target.checked),
          }),
          h('span', {}, h('span', { class: 'feature-id' }, f.id), ' ', f.name),
        ),
        h('button', {
          type: 'button',
          class: 'info-button',
          'aria-label': `About ${f.id}`,
          onclick: () => openFeature(f.id),
        }, 'Info'),
      ),
    ),
  );

  $('feature-search').addEventListener('input', filterPicker);
  groupSelect.addEventListener('change', filterPicker);
  $('feature-show').addEventListener('change', filterPicker);
  $('select-visible').addEventListener('click', () => setVisible(true));
  $('clear-visible').addEventListener('click', () => setVisible(false));
  filterPicker();
}

function setSelected(id, on) {
  if (on) state.selection.add(id);
  else state.selection.delete(id);
  storage.set('selection', [...state.selection]);
  updatePickerCount();
}

function visibleItems() {
  return [...$('feature-list').children].filter((li) => !li.hidden);
}

function setVisible(on) {
  for (const li of visibleItems()) {
    li.querySelector('input').checked = on;
    if (on) state.selection.add(li.dataset.id);
    else state.selection.delete(li.dataset.id);
  }
  storage.set('selection', [...state.selection]);
  filterPicker();
}

function filterPicker() {
  const q = $('feature-search').value.trim().toLowerCase();
  const group = $('feature-group').value;
  const show = $('feature-show').value;
  for (const li of $('feature-list').children) {
    const f = state.features.get(li.dataset.id);
    const selected = state.selection.has(f.id);
    li.hidden = !(
      (!q || f.id.toLowerCase().includes(q) || f.name.toLowerCase().includes(q)) &&
      (!group || f.groups.includes(group)) &&
      (show === 'all' || (show === 'selected') === selected)
    );
  }
  updatePickerCount();
}

function updatePickerCount() {
  updateGenerateSummary();
  const shown = visibleItems().length;
  $('picker-count').textContent =
    `${state.selection.size} selected · ${shown} shown`;
}

function openFeature(id) {
  const f = state.features.get(id);
  const total = Object.values(f.frequency).reduce((a, b) => a + b, 0);
  const body = $('feature-dialog-body');
  const description = f.description.replace(/^\s*##[^\n]*\n/, '');
  body.replaceChildren(
    h('h3', { id: 'feature-dialog-title' }, `${f.id} · ${f.name}`),
    h('table', { class: 'frequency-table' },
      h('caption', { class: 'muted' }, `Values across ${total.toLocaleString()} coded Grambank languages`),
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Value'), h('th', { scope: 'col' }, 'Meaning'), h('th', { scope: 'col' }, 'Languages'))),
      h('tbody', {}, f.codes.map((c) => {
        const n = f.frequency[c.value] || 0;
        return h('tr', {}, h('td', {}, c.value), h('td', {}, c.label),
          h('td', {}, `${n.toLocaleString()} (${total ? Math.round((n / total) * 100) : 0}%)`));
      })),
    ),
    h('div', {}),
    h('p', {}, h('a', { href: `${DATASET.homepage}parameters/${f.id}`, target: '_blank', rel: 'noopener' }, `View ${f.id} on Grambank`)),
  );
  body.children[2].innerHTML = renderMarkdown(description);
  $('feature-dialog').showModal();
}

// ---------- generator ----------

function buildGenerator() {
  const mode = $('mode');
  mode.replaceChildren(...Object.entries(MODES).map(([v, label]) => h('option', { value: v }, label)));
  mode.value = storage.get('mode', 'uniform') in MODES ? storage.get('mode', 'uniform') : 'uniform';
  const pool = $('pool-size');
  pool.replaceChildren(...POOL_SIZES.map((n) => h('option', { value: n }, `${n} languages`)));
  pool.value = String(storage.get('poolSize', 3));
  if (!pool.value) pool.value = '3';

  $('reroll-mode').replaceChildren(...Object.entries(MODES).map(([v, label]) => h('option', { value: v }, label)));
  $('reroll-pool').replaceChildren(...POOL_SIZES.map((n) => h('option', { value: n }, `${n} languages`)));
  $('reroll-mode').addEventListener('change', syncRerollPool);

  const genealogical = $('genealogical');
  genealogical.checked = storage.get('genealogical', false) === true;

  const sync = () => {
    $('pool-field').hidden = mode.value !== 'mix';
    $('genealogical-field').hidden = !(mode.value in GENEALOGICAL_HELP);
    $('mode-help').textContent = [
      MODE_HELP[mode.value],
      genealogical.checked && GENEALOGICAL_HELP[mode.value],
    ].filter(Boolean).join(' ');
    updateGenerateSummary();
    storage.set('mode', mode.value);
    storage.set('poolSize', Number(pool.value));
    storage.set('genealogical', genealogical.checked);
  };
  mode.addEventListener('change', sync);
  pool.addEventListener('change', sync);
  genealogical.addEventListener('change', sync);
  sync();

  $('mashup-name').addEventListener('input', () =>
    showFieldError($('mashup-name'), $('mashup-name-error'), null));
  $('generate-form').addEventListener('submit', (e) => {
    e.preventDefault();
    generate().catch((err) => reportError(err, 'Generating failed'));
  });
}

function settings() {
  return { mode: $('mode').value, poolSize: Number($('pool-size').value), genealogical: $('genealogical').checked };
}

function rerollSettings() {
  return {
    mode: $('reroll-mode').value,
    poolSize: Number($('reroll-pool').value),
    genealogical: $('reroll-genealogical').checked,
  };
}

// A mode's label, noting genealogical weighting where it applies.
function modeLabel(mode, genealogical) {
  return genealogical && mode in GENEALOGICAL_HELP ? `${MODES[mode]}, by language family` : MODES[mode];
}

function rollFor(featureIds, locked, options = settings()) {
  return roll({
    featureIds,
    features: state.features,
    languages: state.languageList,
    locked,
    ...options,
  });
}

async function save(mashup, options) {
  await db.addMashup(mashup);
  state.mashups.push(mashup);
  show(mashup, options);
}

// ---------- names ----------

// A mash-up's current name: a rename if there is one, else the name it was saved with.
function nameOf(mashup) {
  return state.names.get(mashup.lineageId) ?? mashup.name;
}

function lineageNames(exceptLineageId) {
  const names = new Set();
  for (const m of state.mashups) if (m.lineageId !== exceptLineageId) names.add(nameOf(m));
  return names;
}

// Returns { name } or { error }. Names must be unique (exact match) and non-empty.
function checkName(raw, exceptLineageId = null) {
  const name = raw.trim();
  if (!name) return { error: 'Enter a name.' };
  if (lineageNames(exceptLineageId).has(name)) return { error: `“${name}” is already used by another mash-up.` };
  return { name };
}

function defaultName() {
  const used = lineageNames();
  let n = new Set(state.mashups.map((m) => m.lineageId)).size + 1;
  while (used.has(`Untitled mash-up ${n}`)) n++;
  return `Untitled mash-up ${n}`;
}

function showFieldError(input, errorEl, message) {
  errorEl.textContent = message ?? '';
  errorEl.hidden = !message;
  if (message) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

async function rename(lineageId, raw) {
  const { name, error } = checkName(raw, lineageId);
  if (error) return error;
  await db.putName({ lineageId, name, renamedAt: new Date().toISOString() });
  state.names.set(lineageId, name);
  state.renaming = null;
  renderLibrary();
  if (state.current?.lineageId === lineageId) $('current-title').textContent = name;
  document.querySelector(`#library li[data-lineage="${lineageId}"] .rename-button`)?.focus();
  toast(`Renamed to “${name}”.`);
  return null;
}

function startRename(lineageId) {
  state.renaming = lineageId;
  renderLibrary();
  const input = $('rename-input');
  input.focus();
  input.select();
}

function cancelRename() {
  const lineageId = state.renaming;
  state.renaming = null;
  renderLibrary();
  document.querySelector(`#library li[data-lineage="${lineageId}"] .rename-button`)?.focus();
}

function renameForm(latest) {
  const input = h('input', {
    id: 'rename-input',
    type: 'text',
    maxlength: '120',
    'aria-describedby': 'rename-error',
    onkeydown: (e) => {
      if (e.key === 'Escape') cancelRename();
    },
  });
  input.value = nameOf(latest);
  const error = h('p', { id: 'rename-error', class: 'field-error', role: 'alert', hidden: true });
  return h('form', {
    class: 'rename-form',
    onsubmit: (e) => {
      e.preventDefault();
      rename(latest.lineageId, input.value)
        .then((message) => message && showFieldError(input, error, message))
        .catch((err) => reportError(err, 'Renaming failed'));
    },
  },
    h('label', { class: 'field', for: 'rename-input' }, `Rename “${nameOf(latest)}”`), input,
    error,
    h('div', { class: 'row-actions' },
      h('button', { type: 'submit', class: 'primary' }, 'Save name'),
      h('button', { type: 'button', onclick: cancelRename }, 'Cancel'),
    ),
  );
}

async function generate() {
  if (!state.selection.size) {
    toast('Select at least one feature first.');
    $('feature-search').focus();
    return;
  }
  const input = $('mashup-name');
  const typed = input.value.trim();
  const { name, error } = typed ? checkName(typed) : { name: defaultName() };
  showFieldError(input, $('mashup-name-error'), error);
  if (error) {
    input.focus();
    return;
  }
  const featureIds = state.featureList.filter((f) => state.selection.has(f.id)).map((f) => f.id);
  const id = uuid();
  await save({
    id,
    lineageId: id,
    parentId: null,
    iteration: 1,
    name,
    createdAt: new Date().toISOString(),
    dataset: DATASET.version,
    ...rollFor(featureIds),
  }, { expand: true });
  $('mashup-name').value = '';
  toast('Mash-up generated and saved.');
  $('current-title').focus();
}

async function reroll() {
  const m = state.current;
  const locked = new Map(
    withMethods(m).entries.filter((e) => state.locks.has(e.featureId)).map((e) => [e.featureId, e]),
  );
  const siblings = lineage(m.lineageId);
  await save({
    id: uuid(),
    lineageId: m.lineageId,
    parentId: m.id,
    iteration: Math.max(...siblings.map((s) => s.iteration)) + 1,
    name: nameOf(m),
    createdAt: new Date().toISOString(),
    dataset: DATASET.version,
    ...rollFor(m.entries.map((e) => e.featureId), locked, rerollSettings()),
  });
  toast(`Saved as iteration ${state.current.iteration}.`);
}

// ---------- current mash-up ----------

function syncRerollPool() {
  $('reroll-pool-field').hidden = $('reroll-mode').value !== 'mix';
  $('reroll-genealogical-field').hidden = !($('reroll-mode').value in GENEALOGICAL_HELP);
}

// Rerolls default to the mode, pool size and family weighting of the iteration being viewed.
function resetRerollSettings(mashup) {
  $('reroll-mode').value = mashup.mode;
  const pool = String(mashup.poolSize ?? $('pool-size').value);
  $('reroll-pool').value = POOL_SIZES.includes(Number(pool)) ? pool : '3';
  $('reroll-genealogical').checked = mashup.genealogical === true;
  syncRerollPool();
}

// How an entry's value was picked. Entries saved before 0.7.0 have no method:
// unlocked ones were rolled with their iteration's mode, locked ones are
// traced back through the parent iterations.
function methodOf(entry, mashup) {
  if (entry.method) return entry.method;
  if (entry.languageId) return 'mix';
  if (entry.fallback) return 'weighted';
  if (entry.locked) {
    const parent = state.mashups.find((p) => p.id === mashup.parentId);
    const prior = parent?.entries.find((e) => e.featureId === entry.featureId);
    if (prior) return methodOf(prior, parent);
  }
  return mashup.mode;
}

// Copy with the current name and every entry's method resolved, for display and export.
function withMethods(mashup) {
  return {
    ...mashup,
    name: nameOf(mashup),
    entries: mashup.entries.map((e) => ({ ...e, method: methodOf(e, mashup) })),
  };
}

function contributors(mashup) {
  return [...new Set(mashup.entries.map((e) => e.languageId).filter(Boolean))];
}

function lineage(lineageId) {
  return state.mashups.filter((m) => m.lineageId === lineageId).sort((a, b) => a.iteration - b.iteration);
}

// Collapsible panels: #<name>-body is hidden, #<name>-summary shown instead.
// Values are the defaults; the user's choice is remembered per panel.
const COLLAPSIBLE = { generate: false, current: false, validation: true };

function setCollapsed(name, collapsed) {
  storage.set(`collapsed:${name}`, collapsed);
  $(`${name}-body`).hidden = collapsed;
  $(`${name}-summary`).hidden = !collapsed;
  const button = $(`toggle-${name}`);
  button.setAttribute('aria-expanded', String(!collapsed));
  button.querySelector('.toggle-icon').textContent = collapsed ? '▸' : '▾';
  button.querySelector('.toggle-text').textContent = collapsed ? 'Expand' : 'Collapse';
}

function bindCollapsibles() {
  for (const [name, fallback] of Object.entries(COLLAPSIBLE)) {
    setCollapsed(name, storage.get(`collapsed:${name}`, fallback) === true);
    $(`toggle-${name}`).addEventListener('click', () => setCollapsed(name, !$(`${name}-body`).hidden));
  }
}

function updateGenerateSummary() {
  const n = state.selection.size;
  $('generate-summary').textContent =
    `${n} feature${n === 1 ? '' : 's'} selected · ${modeLabel($('mode').value, $('genealogical').checked) ?? ''}`;
}

// The validation status is mirrored into the summary shown while collapsed.
function setValidationStatus(text) {
  $('validation-status').textContent = text;
  $('validation-summary').textContent = text;
}

function updateSummary() {
  const m = state.current;
  if (!m) return;
  const n = state.conflicts.length;
  $('current-summary').textContent = [
    `Iteration ${m.iteration}`,
    `${m.entries.length} features`,
    state.locks.size ? `${state.locks.size} locked` : null,
    n ? `⚠ ${n} rule warning${n === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ');
}

// expand: open the panel, e.g. for a new mash-up or one picked from the library.
function show(mashup, { expand = false } = {}) {
  if (expand) setCollapsed('current', false);
  state.current = mashup;
  resetRerollSettings(mashup);
  state.locks = new Set(mashup.entries.filter((e) => e.locked).map((e) => e.featureId));
  storage.set('current', mashup.id);
  $('current').hidden = false;

  const title = $('current-title');
  title.textContent = nameOf(mashup);
  title.tabIndex = -1;

  const select = $('iteration-select');
  select.replaceChildren(
    ...lineage(mashup.lineageId).map((m) => {
      const parent = state.mashups.find((p) => p.id === m.parentId);
      return h('option', { value: m.id },
        `#${m.iteration} · ${modeLabel(m.mode, m.genealogical)}${parent ? ` · from #${parent.iteration}` : ''}`);
    }),
  );
  select.value = mashup.id;

  const parent = state.mashups.find((p) => p.id === mashup.parentId);
  const donors = contributors(mashup).map((id) => state.languages.get(id)?.name ?? id);
  $('current-meta').textContent = [
    `Iteration ${mashup.iteration}`,
    parent ? `rerolled from #${parent.iteration}` : 'original',
    modeLabel(mashup.mode, mashup.genealogical),
    donors.length ? `languages: ${donors.join(', ')}` : null,
    `${mashup.entries.length} features`,
    formatDate(mashup.createdAt),
  ].filter(Boolean).join(' · ');

  state.conflicts = [];
  renderRows();
  renderLibrary();
  checkConflicts();
}

const valuesOf = (mashup) => Object.fromEntries(mashup.entries.map((e) => [e.featureId, e.value]));

async function conflictsFor(mashups) {
  const rules = await state.rulesReady;
  const results = await rules.evaluateMany(mashups.map((m) => ({ id: m.id, values: valuesOf(m) })));
  const byId = new Map(rules.constraints.map((c) => [c.id, c]));
  const out = new Map();
  for (const [id, statuses] of results) {
    out.set(id, statuses.filter((s) => s.status === 'violated').map((s) => byId.get(s.id)));
  }
  return out;
}

// Iterations are immutable, so each one is checked once per page load.
function conflictsOf(mashup) {
  if (!state.conflictChecks.has(mashup.id)) {
    const check = state.rulesReady.then((rules) => rules.conflicts(valuesOf(mashup)));
    check.catch(() => state.conflictChecks.delete(mashup.id));
    state.conflictChecks.set(mashup.id, check);
  }
  return state.conflictChecks.get(mashup.id);
}

async function checkConflicts() {
  const mashup = state.current;
  const box = $('current-warnings');
  if (!mashup) return;
  if (!state.rules) box.replaceChildren(h('p', { class: 'muted' }, 'Checking feature rules…'));
  let conflicts;
  try {
    conflicts = await conflictsOf(mashup);
  } catch (err) {
    if (state.current === mashup) {
      box.replaceChildren(h('p', { class: 'muted' }, `Rule check failed: ${err.message}`));
    }
    return;
  }
  if (state.current !== mashup) return; // another iteration was opened meanwhile
  state.conflicts = conflicts;
  renderWarnings();
  renderRows();
}

function renderWarnings() {
  const box = $('current-warnings');
  const present = new Set(state.current.entries.map((e) => e.featureId));
  const conflicts = state.conflicts;
  box.classList.toggle('has-warnings', conflicts.length > 0);
  if (!conflicts.length) {
    box.replaceChildren(h('p', { class: 'muted' }, 'No rule conflicts among these features.'));
    return;
  }
  const order = Object.keys(KINDS);
  const sorted = [...conflicts].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  box.replaceChildren(
    h('h3', {}, `⚠ ${conflicts.length} rule warning${conflicts.length === 1 ? '' : 's'}`),
    h('p', { class: 'hint' }, 'These are not prevented: working out how the grammar resolves them is part of the design.'),
    h('ul', {}, sorted.map((c) =>
      h('li', {},
        h('span', { class: `kind kind-${c.kind}`, title: KINDS[c.kind] }, SEVERITY[c.kind]), ' ',
        c.text, ' ',
        h('span', { class: 'involves' }, 'Features: ',
          c.features.filter((f) => present.has(f)).flatMap((f, i) => [
            i ? ', ' : '',
            h('button', { type: 'button', class: 'link-button', onclick: () => openFeature(f) }, f),
          ])),
      ))),
  );
}

// Display order only; stored iterations keep their entry order.
function sortedEntries(entries) {
  const order = (e) => state.features.get(e.featureId)?.order ?? 0;
  const { key, dir } = state.sort;
  const sign = dir === 'desc' ? -1 : 1;
  return [...entries].sort((a, b) => {
    const primary = key === 'value' ? Number(a.value) - Number(b.value) : order(a) - order(b);
    return primary * sign || order(a) - order(b);
  });
}

function setSort(key, dir) {
  state.sort = { key, dir };
  storage.set('rowSort', state.sort);
  renderSortControls();
  if (state.current) renderRows();
}

function renderSortControls() {
  const { key, dir } = state.sort;
  for (const th of document.querySelectorAll('.mashup-table th[data-sort]')) {
    const active = th.dataset.sort === key;
    if (active) th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
    th.querySelector('.sort-indicator').textContent = active ? (dir === 'asc' ? ' ▲' : ' ▼') : ' ↕';
  }
  $('row-sort').value = `${key}:${dir}`;
}

function bindSort() {
  const saved = storage.get('rowSort', null);
  if (saved && ['feature', 'value'].includes(saved.key) && ['asc', 'desc'].includes(saved.dir)) state.sort = saved;
  for (const th of document.querySelectorAll('.mashup-table th[data-sort]')) {
    th.querySelector('button').addEventListener('click', () => {
      const key = th.dataset.sort;
      setSort(key, state.sort.key === key && state.sort.dir === 'asc' ? 'desc' : 'asc');
    });
  }
  $('row-sort').addEventListener('change', (e) => {
    const [key, dir] = e.target.value.split(':');
    setSort(key, dir);
  });
  renderSortControls();
}

function renderRows() {
  const m = state.current;
  $('mashup-rows').replaceChildren(
    ...sortedEntries(m.entries).map((e) => {
      const f = state.features.get(e.featureId);
      const code = f?.codes.find((c) => c.value === e.value);
      const locked = state.locks.has(e.featureId);
      const lang = e.languageId ? state.languages.get(e.languageId) : null;
      const method = methodOf(e, m);
      const byFamily = e.genealogical ? ', by language family' : '';
      let source = '—';
      if (lang) source = `${lang.name} (${lang.family || 'isolate'})`;
      else if (e.fallback) source = `Weighted fallback${byFamily}: no pool language coded`;
      else if (method === 'weighted') source = `Weighted random${byFamily}`;
      else if (method === 'uniform') source = 'Uniform random';
      const conflicting = state.conflicts.some((c) => c.features.includes(e.featureId));
      return h('tr', {
        class: [locked && 'is-locked', conflicting && 'is-conflict'].filter(Boolean).join(' ') || null,
        'data-feature': e.featureId,
      },
        h('td', {}, h('button', {
          type: 'button',
          class: 'lock-button',
          'aria-pressed': String(locked),
          'aria-label': `${locked ? 'Unlock' : 'Lock'} ${e.featureId}`,
          onclick: () => toggleLock(e.featureId),
        }, locked ? '■ Locked' : '□ Lock')),
        h('td', {}, h('button', { type: 'button', class: 'link-button', onclick: () => openFeature(e.featureId) },
          h('span', { class: 'feature-id' }, e.featureId), ' ', f?.name ?? ''),
          conflicting && h('span', { class: 'conflict-flag' }, '⚠ In a rule warning')),
        h('td', { class: 'value' }, h('span', { class: 'value-code' }, e.value), code?.label ?? ''),
        h('td', { class: 'source' }, e.locked ? `${source} · kept from earlier` : source),
      );
    }),
  );
  updateRerollButton();
  updateSummary();
}

function toggleLock(featureId) {
  if (state.locks.has(featureId)) state.locks.delete(featureId);
  else state.locks.add(featureId);
  const row = $('mashup-rows').querySelector(`tr[data-feature="${featureId}"]`);
  const locked = state.locks.has(featureId);
  row.classList.toggle('is-locked', locked);
  const btn = row.querySelector('.lock-button');
  btn.setAttribute('aria-pressed', String(locked));
  btn.setAttribute('aria-label', `${locked ? 'Unlock' : 'Lock'} ${featureId}`);
  btn.textContent = locked ? '■ Locked' : '□ Lock';
  updateRerollButton();
  updateSummary();
}

function updateRerollButton() {
  const all = state.current.entries.length;
  const n = state.locks.size;
  const btn = $('reroll');
  btn.disabled = n >= all;
  btn.textContent = n ? `Reroll ${all - n} unlocked` : 'Reroll all';
}

// ---------- library ----------

function renderLibrary() {
  // Reuse an open rename form so re-renders keep the typed name, error and focus.
  const openForm = document.querySelector('#library .rename-form');
  const keptForm = openForm?.closest('li').dataset.lineage === state.renaming ? openForm : null;
  const focused = keptForm?.contains(document.activeElement) ? document.activeElement : null;
  const selection = focused instanceof HTMLInputElement
    ? [focused.selectionStart, focused.selectionEnd, focused.selectionDirection]
    : null;

  const groups = new Map();
  for (const m of state.mashups) {
    if (!groups.has(m.lineageId)) groups.set(m.lineageId, []);
    groups.get(m.lineageId).push(m);
  }
  const items = [...groups.values()]
    .map((list) => list.sort((a, b) => a.iteration - b.iteration))
    .sort((a, b) => b.at(-1).createdAt.localeCompare(a.at(-1).createdAt));

  $('library-empty').hidden = items.length > 0;
  $('export-all').disabled = items.length === 0;
  $('library').replaceChildren(
    ...items.map((list) => {
      const latest = list.at(-1);
      const current = state.current?.lineageId === latest.lineageId;
      const name = nameOf(latest);
      if (state.renaming === latest.lineageId) {
        return h('li', { class: current ? 'is-current' : null, 'data-lineage': latest.lineageId }, keptForm ?? renameForm(latest));
      }
      return h('li', { class: current ? 'is-current' : null, 'data-lineage': latest.lineageId },
        h('div', {},
          h('button', {
            type: 'button',
            class: 'link-button',
            'aria-current': current ? 'true' : null,
            onclick: () => show(latest, { expand: true }),
          }, name),
          h('span', { class: 'meta' },
            `${list.length} iteration${list.length === 1 ? '' : 's'} (latest #${latest.iteration}) · ${latest.entries.length} features · updated ${formatDate(latest.createdAt)}`),
        ),
        h('div', { class: 'row-actions' },
          h('button', {
            type: 'button',
            'aria-label': `Export iteration ${latest.iteration} of “${name}” as JSON`,
            onclick: () => exportIteration(latest),
          }, 'Export'),
          h('button', {
            type: 'button',
            class: 'rename-button',
            'aria-label': `Rename “${name}”`,
            onclick: () => startRename(latest.lineageId),
          }, 'Rename'),
          h('button', {
            type: 'button',
            class: 'danger',
            'aria-label': `Delete “${name}”`,
            onclick: () => removeLineage(latest).catch((err) => reportError(err, 'Deleting failed')),
          }, 'Delete'),
        ),
      );
    }),
  );
  if (focused?.isConnected) {
    focused.focus();
    if (selection) focused.setSelectionRange(...selection);
  }
}

async function removeLineage(m) {
  const n = lineage(m.lineageId).length;
  if (!confirm(`Delete “${nameOf(m)}” and its ${n} iteration${n === 1 ? '' : 's'}? This cannot be undone.`)) return;
  await db.deleteLineage(m.lineageId);
  state.mashups = state.mashups.filter((x) => x.lineageId !== m.lineageId);
  state.names.delete(m.lineageId);
  if (state.renaming === m.lineageId) state.renaming = null;
  if (state.current?.lineageId === m.lineageId) {
    state.current = null;
    $('current').hidden = true;
  }
  renderLibrary();
  toast('Mash-up deleted.');
}

// ---------- actions ----------

async function exportJson(mashups, filename) {
  let conflicts = new Map();
  try {
    conflicts = await conflictsFor(mashups);
  } catch (err) {
    console.error(err);
  }
  downloadFile(filename, toJson(mashups.map(withMethods), state.features, state.languages, state.dataset, conflicts));
}

function exportIteration(m) {
  exportJson([m], `${slug(nameOf(m))}-${m.iteration}.json`);
}

function bindActions() {
  $('iteration-select').addEventListener('change', (e) => show(state.mashups.find((m) => m.id === e.target.value)));
  $('reroll').addEventListener('click', () => reroll().catch((err) => reportError(err, 'Rerolling failed')));
  $('copy-text').addEventListener('click', () => {
    const m = state.current;
    let checked = true;
    const text = conflictsOf(m)
      .catch(() => {
        checked = false;
        return [];
      })
      .then((conflicts) => toText(withMethods(m), state.features, state.languages, conflicts));
    copyText(text)
      .then(() => toast(checked ? 'Copied to clipboard.' : 'Copied, without rule warnings: the rule check failed.'))
      .catch(() => toast('Copying failed; use Export JSON instead.'));
  });
  $('export-iteration').addEventListener('click', () => exportIteration(state.current));
  $('export-lineage').addEventListener('click', () =>
    exportJson(lineage(state.current.lineageId), `${slug(nameOf(state.current))}-all.json`));
  $('export-all').addEventListener('click', () =>
    exportJson(
      [...state.mashups].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      `mousseron-library-${new Date().toISOString().slice(0, 10)}.json`,
    ));
  $('run-validation').addEventListener('click', () => runValidation());
  $('export-validation').addEventListener('click', exportValidation);
  $('reload-dataset').addEventListener('click', async () => {
    if (!confirm('Download Grambank again and replace the local copy? Saved mash-ups are kept.')) return;
    $('app').hidden = true;
    $('reload-dataset').disabled = true;
    try {
      await fetchDataset();
      location.reload();
    } catch (err) {
      // The local copy is only replaced after a complete download and import.
      $('loader').hidden = true;
      $('app').hidden = false;
      $('reload-dataset').disabled = false;
      reportError(err, 'Re-downloading the dataset failed; your local copy is unchanged');
    }
  });
  $('app-error-dismiss').addEventListener('click', () => {
    $('app-error').hidden = true;
  });
}

// ---------- dataset validation ----------

function languageLink(id) {
  const l = state.languages.get(id);
  return h('a', { href: `${DATASET.homepage}languages/${id}`, target: '_blank', rel: 'noopener' },
    l ? `${l.name} (${l.family || 'isolate'})` : id);
}

function renderValidation() {
  const report = state.validation;
  const out = $('validation-report');
  $('export-validation').disabled = !report;
  if (!report) {
    out.replaceChildren();
    setValidationStatus('Not run yet.');
    return;
  }
  const stale = [];
  if (state.rules && report.rulesVersion !== state.rules.version) stale.push('the rules');
  if (report.datasetImportedAt !== state.dataset.importedAt) stale.push('the dataset');
  setValidationStatus(`${report.languages.toLocaleString()} languages checked in ${report.seconds} s on ${formatDate(report.createdAt)}.` +
    (stale.length ? ` ${stale.join(' and ')} changed since; run again for current results.` : ''));

  const kinds = Object.keys(KINDS);
  const rules = [...report.rules].sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind));
  const th = (t, cls) => h('th', { scope: 'col', class: cls }, t);
  out.replaceChildren(
    h('div', { class: 'table-wrap' },
      h('table', { class: 'validation-table' },
        h('caption', { class: 'muted' }, 'Rule outcomes per language. Expand a rule to see the languages that violate it.'),
        h('thead', {}, h('tr', {}, th('Rule'), th('Kind'), th('Violated', 'num'), th('Satisfied', 'num'), th('Undetermined', 'num'))),
        h('tbody', {}, rules.map((r) =>
          h('tr', {},
            h('td', {}, r.violated.length
              ? h('details', {},
                h('summary', {}, r.text),
                h('p', { class: 'violators' }, r.violated.flatMap((id, i) => (i ? ['; ', languageLink(id)] : [languageLink(id)]))))
              : r.text),
            h('td', {}, h('span', { class: `kind kind-${r.kind}`, title: KINDS[r.kind] }, r.kind)),
            h('td', { class: 'num' }, r.violated.length ? h('strong', {}, String(r.violated.length)) : '0'),
            h('td', { class: 'num' }, String(r.satisfied)),
            h('td', { class: 'num' }, String(r.undetermined)),
          ))),
      ),
    ),
    h('dl', { class: 'kind-legend' }, Object.entries(KINDS).flatMap(([k, text]) =>
      [h('dt', {}, h('span', { class: `kind kind-${k}` }, k)), h('dd', {}, text)])),
    h('h3', {}, 'Pairs that may both be 1'),
    h('p', { class: 'hint' }, 'Not contradictions: Grambank codes these as independent questions. Listed for reference.'),
    h('div', { class: 'table-wrap' },
      h('table', { class: 'validation-table' },
        h('thead', {}, h('tr', {}, th('Features'), th('Both 1', 'num'), th('Both coded', 'num'))),
        h('tbody', {}, report.pairs.map((p) =>
          h('tr', {}, h('td', {}, p.features.join(' + ')), h('td', { class: 'num' }, String(p.both)), h('td', { class: 'num' }, String(p.coded))))),
      ),
    ),
  );
}

// A saved report is current if neither the rules nor the dataset changed since.
function validationCurrent() {
  const r = state.validation;
  return !!r && r.rulesVersion === state.rules.version && r.datasetImportedAt === state.dataset.importedAt;
}

// background: started automatically after start-up, so finishing doesn't announce itself.
async function runValidation({ background = false } = {}) {
  const button = $('run-validation');
  const bar = $('validation-progress');
  button.disabled = true;
  bar.hidden = false;
  bar.removeAttribute('value');
  try {
    setValidationStatus('Loading rules…');
    state.rules ??= await state.rulesReady;
    const report = await validateDataset(state.rules, state.languageList, (done, total) => {
      bar.value = done / total;
      setValidationStatus(`Checking languages… ${done.toLocaleString()} of ${total.toLocaleString()}`);
    });
    report.datasetImportedAt = state.dataset.importedAt;
    await db.putMeta(report);
    state.validation = report;
    renderValidation();
    if (!background) toast('Validation finished.');
  } catch (err) {
    console.error(err);
    setValidationStatus(`Validation failed: ${err.message}`);
  } finally {
    button.disabled = false;
    bar.hidden = true;
  }
}

function exportValidation() {
  const r = state.validation;
  const report = {
    generator: `Mousseron ${VERSION}`,
    dataset: { name: state.dataset.name, version: state.dataset.version, doi: state.dataset.doi },
    ...r,
    rules: r.rules.map((rule) => ({
      ...rule,
      violated: rule.violated.map((id) => ({ id, name: state.languages.get(id)?.name ?? id })),
    })),
  };
  downloadFile(`mousseron-validation-${r.createdAt.slice(0, 10)}.json`, JSON.stringify(report, null, 2));
}

function renderFooter() {
  const d = state.dataset;
  const info = $('dataset-info');
  info.replaceChildren(
    'Feature data: ',
    h('a', { href: d.homepage, target: '_blank', rel: 'noopener' }, `${d.name} ${d.version}`),
    ` (${d.license}). ${d.citation.replace(/https:\/\/doi\.org\/\S+$/, '')}`,
    h('a', { href: `https://doi.org/${d.doi}`, target: '_blank', rel: 'noopener' }, `doi:${d.doi}`),
    `. Stored locally since ${formatDate(d.importedAt)}.`,
  );
  $('reload-dataset').hidden = false;
}

// Start-up errors: the app cannot run, so the loader shows the error.
function fail(err) {
  console.error(err);
  showLoader(`Something went wrong: ${err.message}`, { error: true });
}

// Errors while the app runs: keep the page and show a dismissible alert.
function reportError(err, action = 'Something went wrong') {
  console.error(err);
  if (!state.dataset) return fail(err);
  $('app-error-text').textContent = `${action}: ${err?.message ?? err}`;
  $('app-error').hidden = false;
  $('app-error-dismiss').focus();
}

// ---------- start ----------

async function start() {
  $('app-version').textContent = `v${VERSION}`;
  try {
    if (!(await db.get('meta', 'dataset'))) await fetchDataset();
    await loadData();
  } catch (err) {
    fail(err);
    return;
  }
  $('loader').hidden = true;

  state.selection = new Set(storage.get('selection', []).filter((id) => state.features.has(id)));
  buildPicker();
  buildGenerator();
  bindActions();
  bindSort();
  bindCollapsibles();
  updateGenerateSummary();
  renderFooter();
  renderLibrary();
  renderValidation();
  state.rulesReady = loadRules(state.featureList);
  state.rulesReady
    .then((rules) => {
      state.rules = rules;
      renderValidation();
      // The UI is already shown; validate in the background unless the saved report is current.
      if (!validationCurrent()) runValidation({ background: true });
    })
    .catch((err) => {
      setValidationStatus(err.message);
    });
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason));

  const last = state.mashups.find((m) => m.id === storage.get('current', null));
  if (last) show(last);
  $('app').hidden = false;
}

$('loader-retry').addEventListener('click', () => location.reload());
start();
