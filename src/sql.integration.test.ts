import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';

describe('isolated SQLite analytics engine', () => {
  it('executes filtered aggregates and joins without touching an application database', async () => {
    const SQL = await initSqlJs();
    const database = new SQL.Database();
    try {
      database.run('CREATE TABLE orders (region TEXT, sales REAL)');
      database.run('CREATE TABLE targets (region TEXT, target REAL)');
      database.run("INSERT INTO orders VALUES ('West', 180), ('West', 120), ('East', 75)");
      database.run("INSERT INTO targets VALUES ('West', 250), ('East', 90)");
      const statement = database.prepare('SELECT orders.region, SUM(orders.sales) AS revenue, targets.target FROM orders JOIN targets USING (region) WHERE orders.sales >= 100 GROUP BY orders.region ORDER BY revenue DESC');
      try {
        const rows: Array<Record<string, string | number | null>> = [];
        while (statement.step()) {
          const row = statement.getAsObject();
          rows.push(row as Record<string, string | number | null>);
        }
        expect(rows).toEqual([{ region: 'West', revenue: 300, target: 250 }]);
      } finally {
        statement.free();
      }
    } finally {
      database.close();
    }
  });
});