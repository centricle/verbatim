import express from 'express';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'corpus.db');
const PORT = 7033;

const SPEAKERS = {
  'george-washington': 'George Washington',
  'john-adams': 'John Adams',
  'thomas-jefferson': 'Thomas Jefferson',
  'james-madison': 'James Madison',
  'james-monroe': 'James Monroe',
  'john-quincy-adams': 'John Quincy Adams',
  'andrew-jackson': 'Andrew Jackson',
  'martin-van-buren': 'Martin Van Buren',
  'william-henry-harrison': 'William Henry Harrison',
  'john-tyler': 'John Tyler',
  'james-k-polk': 'James K. Polk',
  'zachary-taylor': 'Zachary Taylor',
  'millard-fillmore': 'Millard Fillmore',
  'franklin-pierce': 'Franklin Pierce',
  'james-buchanan': 'James Buchanan',
  'abraham-lincoln': 'Abraham Lincoln',
  'andrew-johnson': 'Andrew Johnson',
  'ulysses-s-grant': 'Ulysses S. Grant',
  'rutherford-b-hayes': 'Rutherford B. Hayes',
  'james-a-garfield': 'James A. Garfield',
  'chester-a-arthur': 'Chester A. Arthur',
  'grover-cleveland': 'Grover Cleveland',
  'benjamin-harrison': 'Benjamin Harrison',
  'william-mckinley': 'William McKinley',
  'theodore-roosevelt': 'Theodore Roosevelt',
  'william-howard-taft': 'William Howard Taft',
  'woodrow-wilson': 'Woodrow Wilson',
  'warren-g-harding': 'Warren G. Harding',
  'calvin-coolidge': 'Calvin Coolidge',
  'herbert-hoover': 'Herbert Hoover',
  'franklin-d-roosevelt': 'Franklin D. Roosevelt',
  'harry-s-truman': 'Harry S. Truman',
  'dwight-d-eisenhower': 'Dwight D. Eisenhower',
  'john-f-kennedy': 'John F. Kennedy',
  'lyndon-b-johnson': 'Lyndon B. Johnson',
  'richard-nixon': 'Richard Nixon',
  'gerald-ford': 'Gerald Ford',
  'jimmy-carter': 'Jimmy Carter',
  'ronald-reagan': 'Ronald Reagan',
  'george-h-w-bush': 'George H. W. Bush',
  'bill-clinton': 'Bill Clinton',
  'george-w-bush': 'George W. Bush',
  'barack-obama': 'Barack Obama',
  'donald-trump': 'Donald Trump',
  'joe-biden': 'Joe Biden',
  // Founding era
  'alexander-hamilton': 'Alexander Hamilton',
  'james-madison': 'James Madison',
  'john-jay': 'John Jay',
  'constitutional-convention': 'Constitutional Convention',
  'continental-congress': 'Continental Congress',
};

const TYPE_LABELS = {
  tweet: 'Tweet',
  speech: 'Speech',
  address: 'Address',
  remarks: 'Remarks',
  press_conference: 'Press Conference',
  press_gaggle: 'Press Gaggle',
  interview: 'Interview',
  statement: 'Statement',
  executive_order: 'Executive Order',
  proclamation: 'Proclamation',
  memo: 'Memo',
  letter: 'Letter',
  earnings_call: 'Earnings Call',
  truth_social: 'Truth Social',
  founding_document: 'Founding Document',
  essay: 'Essay',
};

const db = new Database(DB_PATH, { readonly: true });

const app = express();

// Search endpoint with FTS5
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').trim();
  const speaker = (req.query.speaker || '').trim();
  const type = (req.query.type || '').trim();
  const dateFrom = (req.query.dateFrom || '').trim();
  const dateTo = (req.query.dateTo || '').trim();
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];

  // FTS match — join on rowid
  let fromClause;
  let selectSnippet;
  if (q) {
    // Escape FTS5 special chars, wrap terms in quotes for prefix matching
    const ftsQuery = q.replace(/['"]/g, '').split(/\s+/).filter(Boolean).map(t => `"${t}"*`).join(' ');
    fromClause = `statements s JOIN statements_fts f ON f.rowid = s.rowid`;
    conditions.push('f.text MATCH ?');
    params.push(ftsQuery);
    selectSnippet = `, snippet(statements_fts, 0, '<mark>', '</mark>', '…', 40) AS snippet`;
  } else {
    fromClause = 'statements s';
    selectSnippet = `, substr(s.text, 1, 300) AS snippet`;
  }

  if (speaker) {
    conditions.push('s.speaker = ?');
    params.push(speaker);
  }
  if (type) {
    conditions.push('s.type = ?');
    params.push(type);
  }
  if (dateFrom) {
    conditions.push('s.date >= ?');
    params.push(dateFrom);
  }
  if (dateTo) {
    conditions.push('s.date <= ?');
    params.push(dateTo);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderBy = q ? 'ORDER BY rank' : 'ORDER BY s.date DESC';

  // Count total
  const countSql = `SELECT COUNT(*) as total FROM ${fromClause} ${where}`;
  const { total } = db.prepare(countSql).get(...params);

  // Fetch page
  const dataSql = `SELECT s.id, s.speaker, s.date, s.type, s.source_url, s.source_name, s.title${selectSnippet} FROM ${fromClause} ${where} ${orderBy} LIMIT ? OFFSET ?`;
  const rows = db.prepare(dataSql).all(...params, limit, offset);

  // Enrich with display names
  const results = rows.map(r => ({
    ...r,
    speaker_name: SPEAKERS[r.speaker] || r.speaker,
    type_label: TYPE_LABELS[r.type] || r.type,
  }));

  res.json({ results, total, page, pages: Math.ceil(total / limit), limit });
});

// Stats endpoint
app.get('/api/stats', (_req, res) => {
  const total = db.prepare('SELECT COUNT(*) as count FROM statements').get().count;

  const bySpeaker = db.prepare(
    'SELECT speaker, COUNT(*) as count FROM statements GROUP BY speaker ORDER BY count DESC'
  ).all().map(r => ({ ...r, name: SPEAKERS[r.speaker] || r.speaker }));

  const byType = db.prepare(
    'SELECT type, COUNT(*) as count FROM statements GROUP BY type ORDER BY count DESC'
  ).all().map(r => ({ ...r, label: TYPE_LABELS[r.type] || r.type }));

  const bySource = db.prepare(
    'SELECT source_name, COUNT(*) as count FROM statements GROUP BY source_name ORDER BY count DESC'
  ).all();

  const dateRange = db.prepare(
    "SELECT MIN(date) as earliest, MAX(date) as latest FROM statements WHERE date IS NOT NULL AND date != ''"
  ).get();

  res.json({ total, by_speaker: bySpeaker, by_type: byType, by_source: bySource, date_range: dateRange });
});

// Speakers list
app.get('/api/speakers', (_req, res) => {
  const rows = db.prepare(
    'SELECT speaker, COUNT(*) as count FROM statements GROUP BY speaker ORDER BY count DESC'
  ).all();

  const speakers = rows.map(r => ({
    slug: r.speaker,
    name: SPEAKERS[r.speaker] || r.speaker,
    count: r.count,
  }));

  res.json(speakers);
});

app.listen(PORT, () => {
  console.log(`[verbatim] API listening on http://localhost:${PORT}`);
});
