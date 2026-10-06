import * as db from './db.js';
import { DATASET, GROUPS, download, importArchive } from './grambank.js';
import { MODES, roll } from './generate.js';
import { toJson, toText } from './format.js';
import { render as renderMarkdown } from './markdown.js';
import { VERSION } from './version.js';

const MODE_HELP = {
  uniform: 'Every value of a feature is equally likely.',
  weighted: 'Values are picked in proportion to how often they occur among Grambank languages.',
  mix: 'A pool of real languages is drawn at random; each feature takes its value from one of them.',
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
  el.append(...children.flat().filter((c) => c != null));
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

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
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

  const sync = () => {
    $('pool-field').hidden = mode.value !== 'mix';
    $('mode-help').textContent = MODE_HELP[mode.value];
    storage.set('mode', mode.value);
    storage.set('poolSize', Number(pool.value));
  };
  mode.addEventListener('change', sync);
  pool.addEventListener('change', sync);
  sync();

  $('generate-form').addEventListener('submit', (e) => {
    e.preventDefault();
    generate().catch(fail);
  });
}

function settings() {
  return { mode: $('mode').value, poolSize: Number($('pool-size').value) };
}

function rollFor(featureIds, locked) {
  return roll({
    featureIds,
    features: state.features,
    languages: state.languageList,
    locked,
    ...settings(),
  });
}

async function save(mashup) {
  await db.addMashup(mashup);
  state.mashups.push(mashup);
  show(mashup);
}

async function generate() {
  if (!state.selection.size) {
    toast('Select at least one feature first.');
    $('feature-search').focus();
    return;
  }
  const featureIds = state.featureList.filter((f) => state.selection.has(f.id)).map((f) => f.id);
  const id = uuid();
  const count = new Set(state.mashups.map((m) => m.lineageId)).size + 1;
  await save({
    id,
    lineageId: id,
    parentId: null,
    iteration: 1,
    name: $('mashup-name').value.trim() || `Untitled mash-up ${count}`,
    createdAt: new Date().toISOString(),
    dataset: DATASET.version,
    ...rollFor(featureIds),
  });
  $('mashup-name').value = '';
  toast('Mash-up generated and saved.');
  $('current-title').focus();
}

async function reroll() {
  const m = state.current;
  const locked = new Map(m.entries.filter((e) => state.locks.has(e.featureId)).map((e) => [e.featureId, e]));
  const siblings = lineage(m.lineageId);
  await save({
    id: uuid(),
    lineageId: m.lineageId,
    parentId: m.id,
    iteration: Math.max(...siblings.map((s) => s.iteration)) + 1,
    name: m.name,
    createdAt: new Date().toISOString(),
    dataset: DATASET.version,
    ...rollFor(m.entries.map((e) => e.featureId), locked),
  });
  toast(`Saved as iteration ${state.current.iteration}.`);
}

// ---------- current mash-up ----------

function contributors(mashup) {
  return [...new Set(mashup.entries.map((e) => e.languageId).filter(Boolean))];
}

function lineage(lineageId) {
  return state.mashups.filter((m) => m.lineageId === lineageId).sort((a, b) => a.iteration - b.iteration);
}

function show(mashup) {
  state.current = mashup;
  state.locks = new Set(mashup.entries.filter((e) => e.locked).map((e) => e.featureId));
  storage.set('current', mashup.id);
  $('current').hidden = false;

  const title = $('current-title');
  title.textContent = mashup.name;
  title.tabIndex = -1;

  const select = $('iteration-select');
  select.replaceChildren(
    ...lineage(mashup.lineageId).map((m) => {
      const parent = state.mashups.find((p) => p.id === m.parentId);
      return h('option', { value: m.id },
        `#${m.iteration} · ${MODES[m.mode]}${parent ? ` · from #${parent.iteration}` : ''}`);
    }),
  );
  select.value = mashup.id;

  const parent = state.mashups.find((p) => p.id === mashup.parentId);
  const donors = contributors(mashup).map((id) => state.languages.get(id)?.name ?? id);
  $('current-meta').textContent = [
    `Iteration ${mashup.iteration}`,
    parent ? `rerolled from #${parent.iteration}` : 'original',
    MODES[mashup.mode],
    donors.length ? `languages: ${donors.join(', ')}` : null,
    `${mashup.entries.length} features`,
    formatDate(mashup.createdAt),
  ].filter(Boolean).join(' · ');

  renderRows();
  renderLibrary();
}

function renderRows() {
  const m = state.current;
  $('mashup-rows').replaceChildren(
    ...m.entries.map((e) => {
      const f = state.features.get(e.featureId);
      const code = f?.codes.find((c) => c.value === e.value);
      const locked = state.locks.has(e.featureId);
      const lang = e.languageId ? state.languages.get(e.languageId) : null;
      let source = '—';
      if (lang) source = `${lang.name} (${lang.family || 'isolate'})`;
      else if (e.fallback) source = 'Weighted fallback: no pool language coded';
      else if (m.mode === 'weighted') source = 'Weighted random';
      else if (m.mode === 'uniform') source = 'Uniform random';
      return h('tr', { class: locked ? 'is-locked' : null },
        h('td', {}, h('button', {
          type: 'button',
          class: 'lock-button',
          'aria-pressed': String(locked),
          'aria-label': `${locked ? 'Unlock' : 'Lock'} ${e.featureId}`,
          onclick: () => toggleLock(e.featureId),
        }, locked ? '■ Locked' : '□ Lock')),
        h('td', {}, h('button', { type: 'button', class: 'link-button', onclick: () => openFeature(e.featureId) },
          h('span', { class: 'feature-id' }, e.featureId), ' ', f?.name ?? '')),
        h('td', { class: 'value' }, h('span', { class: 'value-code' }, e.value), code?.label ?? ''),
        h('td', { class: 'source' }, e.locked ? `${source} · kept from earlier` : source),
      );
    }),
  );
  updateRerollButton();
}

function toggleLock(featureId) {
  if (state.locks.has(featureId)) state.locks.delete(featureId);
  else state.locks.add(featureId);
  const row = [...$('mashup-rows').children][state.current.entries.findIndex((e) => e.featureId === featureId)];
  const locked = state.locks.has(featureId);
  row.classList.toggle('is-locked', locked);
  const btn = row.querySelector('.lock-button');
  btn.setAttribute('aria-pressed', String(locked));
  btn.setAttribute('aria-label', `${locked ? 'Unlock' : 'Lock'} ${featureId}`);
  btn.textContent = locked ? '■ Locked' : '□ Lock';
  updateRerollButton();
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
      return h('li', { class: current ? 'is-current' : null },
        h('div', {},
          h('button', {
            type: 'button',
            class: 'link-button',
            'aria-current': current ? 'true' : null,
            onclick: () => show(latest),
          }, latest.name),
          h('span', { class: 'meta' },
            `${list.length} iteration${list.length === 1 ? '' : 's'} (latest #${latest.iteration}) · ${latest.entries.length} features · updated ${formatDate(latest.createdAt)}`),
        ),
        h('div', { class: 'row-actions' },
          h('button', {
            type: 'button',
            'aria-label': `Export iteration ${latest.iteration} of “${latest.name}” as JSON`,
            onclick: () => exportIteration(latest),
          }, 'Export'),
          h('button', {
            type: 'button',
            class: 'danger',
            'aria-label': `Delete “${latest.name}”`,
            onclick: () => removeLineage(latest),
          }, 'Delete'),
        ),
      );
    }),
  );
}

async function removeLineage(m) {
  const n = lineage(m.lineageId).length;
  if (!confirm(`Delete “${m.name}” and its ${n} iteration${n === 1 ? '' : 's'}? This cannot be undone.`)) return;
  await db.deleteLineage(m.lineageId);
  state.mashups = state.mashups.filter((x) => x.lineageId !== m.lineageId);
  if (state.current?.lineageId === m.lineageId) {
    state.current = null;
    $('current').hidden = true;
  }
  renderLibrary();
  toast('Mash-up deleted.');
}

// ---------- actions ----------

function exportJson(mashups, filename) {
  downloadFile(filename, toJson(mashups, state.features, state.languages, state.dataset));
}

function exportIteration(m) {
  exportJson([m], `${slug(m.name)}-${m.iteration}.json`);
}

function bindActions() {
  $('iteration-select').addEventListener('change', (e) => show(state.mashups.find((m) => m.id === e.target.value)));
  $('reroll').addEventListener('click', () => reroll().catch(fail));
  $('copy-text').addEventListener('click', () =>
    copyText(toText(state.current, state.features, state.languages))
      .then(() => toast('Copied to clipboard.'))
      .catch(() => toast('Copying failed; use Export JSON instead.')));
  $('export-iteration').addEventListener('click', () => exportIteration(state.current));
  $('export-lineage').addEventListener('click', () =>
    exportJson(lineage(state.current.lineageId), `${slug(state.current.name)}-all.json`));
  $('export-all').addEventListener('click', () =>
    exportJson(
      [...state.mashups].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      `mousseron-library-${new Date().toISOString().slice(0, 10)}.json`,
    ));
  $('reload-dataset').addEventListener('click', async () => {
    if (!confirm('Download Grambank again and replace the local copy? Saved mash-ups are kept.')) return;
    $('app').hidden = true;
    try {
      await fetchDataset();
      location.reload();
    } catch (err) {
      fail(err);
    }
  });
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

function fail(err) {
  console.error(err);
  showLoader(`Something went wrong: ${err.message}`, { error: true });
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
  renderFooter();
  renderLibrary();

  const last = state.mashups.find((m) => m.id === storage.get('current', null));
  if (last) show(last);
  $('app').hidden = false;
}

$('loader-retry').addEventListener('click', () => location.reload());
start();
