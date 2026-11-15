// Database helpers for the loaders. These connect as DATABASE_URL from .env
// (the owner role), over a WebSocket Pool rather than the HTTP driver the
// Netlify functions use: schema files hold several statements, and a load
// needs an interactive transaction.
//
// Table and column names passed here come from the loader's own constants,
// never from input. Values always travel as bound parameters.
import { Pool, neonConfig } from '@neondatabase/serverless';

if (!neonConfig.webSocketConstructor && globalThis.WebSocket) {
  neonConfig.webSocketConstructor = globalThis.WebSocket;
}

export async function withClient(fn) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (run with node --env-file=.env)');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
    await pool.end();
  }
}

export async function inTransaction(client, fn) {
  await client.query('BEGIN');
  try {
    const result = await fn();
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

// Insert rows in batches of `size`, one INSERT ... SELECT FROM unnest(...) per
// batch: one array parameter per column, so a batch is one round trip
// whatever its row count. `columns` is [[name, postgresType], ...].
export async function insertBatches(client, table, columns, rows, size = 1000) {
  const names = columns.map(([name]) => name).join(', ');
  const arrays = columns.map(([, type], i) => `$${i + 1}::${type}[]`).join(', ');
  const text = `INSERT INTO ${table} (${names}) SELECT * FROM unnest(${arrays})`;
  for (let i = 0; i < rows.length; i += size) {
    const batch = rows.slice(i, i + size);
    await client.query(text, columns.map(([name]) => batch.map((row) => row[name] ?? null)));
  }
}
