// Reads data/corpus/release.jsonl (written by build_release.py) into the rows
// the Postgres load writes. Pure: text in, rows out, so tests need no
// database and no file system.
//
// The release is already the edited corpus: every rule about what it holds,
// and every change made to the scrape, lives in build_release.py. This step
// only picks the collections the site serves and the fields the table has,
// and changes no value. A field the table has and a record lacks loads as
// NULL.

// Collections loaded into Postgres. Federal Register records (`executive`)
// stay in the release only for now.
export const COLLECTIONS = ['core', 'voices'];

// Every column the loader writes, with its Postgres type. db/corpus.sql
// declares the same columns; `tsv` is generated there.
export const LOAD_COLUMNS = [
  ['id', 'text'],
  ['speaker', 'text'],
  ['speaker_name', 'text'],
  ['date', 'date'],
  ['date_precision', 'text'],
  ['collection', 'text'],
  ['genre', 'text'],
  ['type', 'text'],
  ['title', 'text'],
  ['source_name', 'text'],
  ['source_url', 'text'],
  ['rights_group', 'text'],
  ['rights', 'text'],
  ['attribution', 'text'],
  ['proposed', 'date'],
  ['certified', 'date'],
  ['text', 'text'],
];
export const COLUMNS = LOAD_COLUMNS.map(([name]) => name);

/** Every record in the release, in file order. A malformed line throws, naming it. */
export function parseRelease(text) {
  const records = [];
  text.split('\n').forEach((line, i) => {
    if (line === '') return;
    try {
      records.push(JSON.parse(line));
    } catch (err) {
      throw new Error(`release.jsonl line ${i + 1}: ${err.message}`);
    }
  });
  return records;
}

/** The rows to load: records in COLLECTIONS, reduced to COLUMNS. */
export function siteRows(records) {
  return records
    .filter((r) => COLLECTIONS.includes(r.collection))
    .map((r) => Object.fromEntries(COLUMNS.map((name) => [name, r[name] ?? null])));
}
