// Minimal zip reader: central directory lookup plus stored/deflate entries.
const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

export function listEntries(buffer) {
  const view = new DataView(buffer);
  const min = Math.max(0, buffer.byteLength - 65557);
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= min; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip archive');

  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== CENTRAL_SIG) throw new Error('Corrupt zip directory');
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const name = decoder.decode(new Uint8Array(buffer, p + 46, nameLen));
    entries.set(name, {
      name,
      method: view.getUint16(p + 10, true),
      compressedSize: view.getUint32(p + 20, true),
      size: view.getUint32(p + 24, true),
      offset: view.getUint32(p + 42, true),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function findEntry(entries, suffix) {
  for (const [name, entry] of entries) if (name.endsWith(suffix)) return entry;
  throw new Error(`Missing ${suffix} in archive`);
}

// Returns a ReadableStream of decoded text for one entry.
export function entryTextStream(buffer, entry) {
  const view = new DataView(buffer);
  if (view.getUint32(entry.offset, true) !== LOCAL_SIG) throw new Error('Corrupt zip entry');
  const nameLen = view.getUint16(entry.offset + 26, true);
  const extraLen = view.getUint16(entry.offset + 28, true);
  const start = entry.offset + 30 + nameLen + extraLen;
  const data = new Uint8Array(buffer, start, entry.compressedSize);
  let stream = new Blob([data]).stream();
  if (entry.method === 8) stream = stream.pipeThrough(new DecompressionStream('deflate-raw'));
  else if (entry.method !== 0) throw new Error(`Unsupported zip method ${entry.method}`);
  return stream.pipeThrough(new TextDecoderStream());
}

export async function entryText(buffer, entry) {
  let text = '';
  for await (const chunk of iterate(entryTextStream(buffer, entry))) text += chunk;
  return text;
}

// ReadableStream async iteration is not yet universal (Safari).
export async function* iterate(stream) {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}
