import * as duckdb from '@duckdb/duckdb-wasm';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';

let databasePromise;

async function openDatabase(url) {
  const bundle = await duckdb.selectBundle({
    eh: { mainModule: ehWasm, mainWorker: ehWorker },
    mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
  });
  const worker = new Worker(bundle.mainWorker);
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  try {
    await db.instantiate(bundle.mainModule);
    // A full small download avoids relying on Pages HTTP range support.
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Published database unavailable (${response.status})`);
    await db.registerFileBuffer('public.duckdb', new Uint8Array(await response.arrayBuffer()));
    await db.open({ path: 'public.duckdb', accessMode: duckdb.DuckDBAccessMode.READ_ONLY });
    return db;
  } catch (error) {
    await db.terminate();
    throw error;
  }
}

const dateFields = new Set(['week_end', 'week_ending_date', 'date_end']);

export async function queryPublicDatabase(url, sql, params) {
  if (!databasePromise) {
    databasePromise = openDatabase(url).catch(error => {
      databasePromise = undefined;
      throw error;
    });
  }
  const db = await databasePromise;
  const connection = await db.connect();
  try {
    const statement = await connection.prepare(sql);
    try {
      const table = await statement.query(...params);
      return table.toArray().map(row => Object.fromEntries(
        Object.entries(row.toJSON()).map(([key, value]) => {
          if (value != null && dateFields.has(key)) {
            return [key, new Date(value).toISOString().slice(0, 19)];
          }
          return [key, typeof value === 'bigint' ? Number(value) : value];
        }),
      ));
    } finally {
      await statement.close();
    }
  } finally {
    await connection.close();
  }
}
