// Streaming RFC 4180 CSV parser. Feed text chunks with push(), finish with end().
export class CsvParser {
  constructor(onRow) {
    this.onRow = onRow;
    this.row = [];
    this.field = '';
    this.inQuotes = false;
    this.justClosed = false;
  }

  push(chunk) {
    let start = 0;
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk.charCodeAt(i);
      if (this.inQuotes) {
        if (c === 34) {
          this.field += chunk.slice(start, i);
          start = i + 1;
          this.inQuotes = false;
          this.justClosed = true;
        }
        continue;
      }
      if (c === 34) {
        this.field += chunk.slice(start, i);
        if (this.justClosed) this.field += '"';
        this.inQuotes = true;
        this.justClosed = false;
        start = i + 1;
        continue;
      }
      this.justClosed = false;
      if (c === 44) {
        this.row.push(this.field + chunk.slice(start, i));
        this.field = '';
        start = i + 1;
      } else if (c === 10) {
        this.row.push(this.field + chunk.slice(start, i));
        this.field = '';
        start = i + 1;
        this.emit();
      } else if (c === 13) {
        this.field += chunk.slice(start, i);
        start = i + 1;
      }
    }
    this.field += chunk.slice(start);
  }

  end() {
    if (this.field !== '' || this.row.length) {
      this.row.push(this.field);
      this.field = '';
      this.emit();
    }
  }

  emit() {
    const row = this.row;
    this.row = [];
    if (row.length === 1 && row[0] === '') return;
    this.onRow(row);
  }
}

// Calls onRecord(object) for each data row, keyed by the header row.
export function recordParser(onRecord) {
  let header = null;
  return new CsvParser((row) => {
    if (!header) {
      header = row;
      return;
    }
    const rec = {};
    for (let i = 0; i < header.length; i++) rec[header[i]] = row[i] ?? '';
    onRecord(rec);
  });
}

export function parseCsv(text) {
  const out = [];
  const p = recordParser((r) => out.push(r));
  p.push(text);
  p.end();
  return out;
}
