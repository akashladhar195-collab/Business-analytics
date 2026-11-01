import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import type { Database } from 'sql.js';
import type { Dataset } from './data';
import { validateReadOnlySql } from './sql';

const maxDatasetRows = 25_000;
const maxDatasetColumns = 160;
const maxResultRows = 1_000;

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

self.onmessage = async (event: MessageEvent<{ sql: string; datasets: Dataset[] }>) => {
  let db: Database | undefined;
  try {
    validateReadOnlySql(event.data.sql);
    const totalRows = event.data.datasets.reduce((sum, dataset) => sum + dataset.rows.length, 0);
    const totalColumns = event.data.datasets.reduce((sum, dataset) => sum + dataset.columns.length, 0);
    if (totalRows > maxDatasetRows) throw new Error(`Queries are limited to ${maxDatasetRows.toLocaleString()} combined source rows. Remove an unused dataset or narrow the workspace.`);
    if (totalColumns > maxDatasetColumns) throw new Error(`Queries are limited to ${maxDatasetColumns} combined source columns.`);
    const SQL = await initSqlJs({ locateFile: () => wasmUrl });
    db = new SQL.Database();
    for (const dataset of event.data.datasets) {
      if (dataset.rows.length > maxDatasetRows) throw new Error(`Dataset "${dataset.name}" is over the ${maxDatasetRows.toLocaleString()} row query limit.`);
      const definitions = dataset.columns.map((column) => `${quoteIdentifier(column.key)} ${column.type === 'number' ? 'REAL' : 'TEXT'}`).join(', ');
      db.run(`CREATE TABLE ${quoteIdentifier(dataset.tableName)} (${definitions})`);
      const placeholders = dataset.columns.map(() => '?').join(', ');
      const insert = db.prepare(`INSERT INTO ${quoteIdentifier(dataset.tableName)} VALUES (${placeholders})`);
      db.run('BEGIN TRANSACTION');
      for (const row of dataset.rows) insert.run(dataset.columns.map((column) => row[column.key]));
      insert.free();
      db.run('COMMIT');
    }
    const statement = db.prepare(event.data.sql);
    const columns = statement.getColumnNames();
    const rows: Array<Record<string, string | number | null>> = [];
    while (rows.length < maxResultRows && statement.step()) {
      const values = statement.get();
      rows.push(Object.fromEntries(columns.map((column, index) => [column, values[index] as string | number | null])));
    }
    const truncated = rows.length === maxResultRows && statement.step();
    statement.free();
    self.postMessage({ columns, rows, truncated });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Query could not be completed.' });
  } finally {
    db?.close();
  }
};