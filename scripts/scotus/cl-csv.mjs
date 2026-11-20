// CourtListener's bulk CSV, cut down to the Supreme Court's rows.
//
// The files come from PostgreSQL's COPY ... WITH (FORMAT csv, ENCODING utf8,
// ESCAPE '\', HEADER), the dialect its load-bulk-data script names: fields
// are separated by commas, quoted with '"', and inside quotes a backslash
// escapes the next quote or backslash. Opinion text carries newlines, quotes
// and backslashes, so rows are found by a state machine over the bytes, never
// by splitting lines, and a kept row is written out byte for byte: a slice
// reads with the same COPY options as the original.
//
// Delimiters are ASCII, and no byte of a multibyte UTF-8 character is ASCII,
// so working on bytes is safe.
const QUOTE = 0x22;
const ESC = 0x5c;
const COMMA = 0x2c;
const LF = 0x0a;

// Calls onRow(row, bounds) per row: row is the row's bytes including its
// newline, bounds[i] the [start, end) of field i within it, for each index in
// `wanted` (every field when wanted is null). A row is a fresh Buffer or a
// view into the chunk it ended in.
export class RowSplitter {
  constructor(onRow, wanted = null) {
    this.onRow = onRow;
    this.wanted = wanted;
    this.inQuote = false;
    this.escaped = false;
    this.pending = [];
    this.rowLen = 0;
    this.field = 0;
    this.fieldStart = 0;
    this.bounds = [];
  }

  #want(i) {
    return this.wanted === null || this.wanted.includes(i);
  }

  push(chunk) {
    const len = chunk.length;
    let rowStart = 0;
    let nq = -2; // cached next quote / escape at or after i; -1 none left
    let ne = -2;
    let i = 0;
    while (i < len) {
      if (this.inQuote) {
        if (this.escaped) {
          this.escaped = false;
          i++;
          continue;
        }
        // Inside quotes only a quote or a backslash matters: jump to the
        // nearer one.
        if (nq !== -1 && nq < i) nq = chunk.indexOf(QUOTE, i);
        if (ne !== -1 && ne < i) ne = chunk.indexOf(ESC, i);
        const j = nq === -1 ? ne : ne === -1 ? nq : Math.min(nq, ne);
        if (j === -1) {
          i = len;
          break;
        }
        if (chunk[j] === ESC) this.escaped = true;
        else this.inQuote = false;
        i = j + 1;
        continue;
      }
      const b = chunk[i];
      if (b === QUOTE) this.inQuote = true;
      else if (b === COMMA || b === LF) {
        const pos = this.rowLen + (i - rowStart);
        if (this.#want(this.field)) this.bounds[this.field] = [this.fieldStart, pos];
        this.field++;
        this.fieldStart = pos + 1;
        if (b === LF) {
          const tail = chunk.subarray(rowStart, i + 1);
          const row = this.pending.length ? Buffer.concat([...this.pending, tail]) : tail;
          this.onRow(row, this.bounds);
          this.pending = [];
          this.rowLen = 0;
          this.field = 0;
          this.fieldStart = 0;
          this.bounds = [];
          rowStart = i + 1;
        }
      }
      i++;
    }
    if (rowStart < len) {
      this.pending.push(chunk.subarray(rowStart));
      this.rowLen += len - rowStart;
    }
  }

  // A last row with no trailing newline.
  end() {
    if (!this.pending.length) return;
    this.push(Buffer.from('\n'));
  }
}

// A field's value: null for an unquoted empty field (COPY's NULL), else the
// text with its quotes removed and escapes undone.
export function fieldValue(row, [start, end]) {
  let s = row.subarray(start, end).toString('utf8');
  if (s.endsWith('\r')) s = s.slice(0, -1);
  if (s === '') return null;
  if (s.length >= 2 && s[0] === '"' && s.at(-1) === '"') return s.slice(1, -1).replace(/\\(["\\])/g, '$1');
  return s;
}

// Whether a row belongs to the slice: `court` matches the key column's text,
// `in` looks its integer up in an id set an earlier table built.
export function predicate(spec, sets) {
  if (spec.court) return (v) => v === spec.court;
  const set = sets[spec.in];
  if (!set) throw new Error(`${spec.table}: needs the ${spec.in} ids from an earlier table`);
  return (v) => v !== null && set.has(Number(v));
}

// Streams one table through the predicate. `write(buf)` receives the header
// and every kept row, in order, and may return a promise (backpressure).
// Returns counts and, when spec.keeps, the kept rows' ids.
export async function slice(chunks, spec, sets, write) {
  const keep = predicate(spec, sets);
  const ids = spec.keeps ? new Set() : null;
  let header = null;
  let keyAt = -1;
  let idAt = -1;
  let rows = 0;
  let kept = 0;
  let out = [];
  const splitter = new RowSplitter((row, bounds) => {
    if (!header) {
      header = bounds.map((b) => fieldValue(row, b));
      keyAt = header.indexOf(spec.key);
      idAt = header.indexOf('id');
      if (keyAt < 0) throw new Error(`${spec.table}: no ${spec.key} column in ${header.join(',')}`);
      if (ids && idAt < 0) throw new Error(`${spec.table}: no id column`);
      splitter.wanted = ids ? [keyAt, idAt] : [keyAt];
      out.push(row);
      return;
    }
    rows++;
    const b = bounds[keyAt];
    if (!b) throw new Error(`${spec.table}: row ${rows} has no field ${keyAt}`);
    if (!keep(fieldValue(row, b))) return;
    kept++;
    if (ids) ids.add(Number(fieldValue(row, bounds[idAt])));
    out.push(row);
  });
  for await (const chunk of chunks) {
    splitter.push(chunk);
    if (out.length) {
      const batch = out;
      out = [];
      await write(batch.length === 1 ? batch[0] : Buffer.concat(batch));
    }
  }
  splitter.end();
  if (out.length) await write(Buffer.concat(out));
  if (!header) throw new Error(`${spec.table}: empty file`);
  return { table: spec.table, header, rows, kept, ids };
}
