// Small Markdown subset renderer for Grambank feature descriptions.
// All source text is HTML-escaped before markup is applied; character references
// (&#577;, &oacute;) are kept, and a few HTML tags used in the descriptions are
// restored without their attributes (see allowHtml).
const escape = (s) =>
  s.replace(/&(?!#\d+;|#x[\da-f]+;|[a-z]\w*;)/gi, '&amp;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Tags restored from escaped text. Table cells keep colspan/rowspan only.
const ALLOWED_TAGS = new Set(['sup', 'sub', 'br', 'table', 'thead', 'tbody', 'tr', 'th', 'td']);
const SPAN_ATTRS = new Set(['colspan', 'rowspan']);

function allowHtml(escaped) {
  return escaped.replace(/&lt;(\/?)([a-z]+)((?:\s+[\w-]+(?:=&quot;.*?&quot;)?)*)\s*\/?&gt;/gi, (tag, close, name, attrs) => {
    const n = name.toLowerCase();
    if (n === 'img') {
      // Linked rather than embedded: the app loads nothing from third parties.
      const src = attrs.match(/\ssrc=&quot;(https:\/\/[^\s&]+)&quot;/i);
      return src ? `<a href="${src[1]}" target="_blank" rel="noopener">View image</a>` : '';
    }
    if (!ALLOWED_TAGS.has(n)) return tag;
    if (close) return `</${n}>`;
    const kept = [...attrs.matchAll(/([\w-]+)=&quot;(\d+)&quot;/g)]
      .filter(([, a]) => SPAN_ATTRS.has(a.toLowerCase()) && (n === 'td' || n === 'th'))
      .map(([, a, v]) => ` ${a.toLowerCase()}="${v}"`);
    return `<${n}${kept.join('')}>`;
  });
}

function inline(text) {
  const codes = [];
  let s = escape(text).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = allowHtml(s)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/(^|\W)_([^_\s][^_]*)_(?=\W|$)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));

export function render(md) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    let m;
    if (trimmed.startsWith('```')) {
      flush();
      const code = [];
      while (++i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i]);
      out.push(`<pre>${escape(code.join('\n'))}</pre>`);
    } else if (/^<table\b/i.test(trimmed)) {
      // Raw HTML table, possibly over several lines.
      flush();
      const html = [];
      while (i < lines.length) {
        html.push(lines[i].trim());
        if (/<\/table>/i.test(lines[i])) break;
        i++;
      }
      out.push(`<div class="table-wrap">${inline(html.join(' '))}</div>`);
    } else if ((m = trimmed.match(/^(#{1,6})\s+(.*)$/))) {
      flush();
      const level = Math.min(6, m[1].length + 2);
      out.push(`<h${level}>${inline(m[2])}</h${level}>`);
    } else if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      flush();
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        const item = lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '').trim();
        if (item) items.push(`<li>${inline(item)}</li>`);
        i++;
      }
      i--;
      const tag = ordered ? 'ol' : 'ul';
      if (items.length) out.push(`<${tag}>${items.join('')}</${tag}>`);
    } else if (trimmed.startsWith('|')) {
      flush();
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++]);
      i--;
      const body = rows.filter((r) => !/^\s*\|?[\s:|-]+\|?\s*$/.test(r));
      const [head, ...rest] = body;
      out.push(
        '<div class="table-wrap"><table>' +
          (head ? `<thead><tr>${cells(head).map((c) => `<th>${c}</th>`).join('')}</tr></thead>` : '') +
          `<tbody>${rest.map((r) => `<tr>${cells(r).map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>` +
          '</table></div>',
      );
    } else if (!trimmed) {
      flush();
    } else {
      para.push(trimmed);
    }
  }
  flush();
  return out.join('\n');
}
