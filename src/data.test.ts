import { describe, expect, it } from 'vitest';
import { calculateMetrics, getDataQuality, makeRetailSample, renameColumn } from './data';
import { validateReadOnlySql } from './sql';

describe('synthetic retail dataset', () => {
  it('calculates revenue, profit, and margin from the generated rows', () => {
    const dataset = makeRetailSample(12);
    const metrics = calculateMetrics(dataset);
    const revenueKey = dataset.mappings.revenue;
    const costKey = dataset.mappings.cost;
    if (!revenueKey || !costKey) throw new Error('Sample data mappings are missing.');
    const rowRevenue = dataset.rows.reduce((sum, row) => sum + Number(row[revenueKey]), 0);
    const rowCost = dataset.rows.reduce((sum, row) => sum + Number(row[costKey]), 0);
    expect(dataset.isSynthetic).toBe(true);
    expect(dataset.rows).toHaveLength(12);
    expect(metrics.revenue).toBeCloseTo(rowRevenue);
    expect(metrics.profit).toBeCloseTo(rowRevenue - rowCost);
    expect(metrics.margin).toBeCloseTo((rowRevenue - rowCost) / rowRevenue * 100);
    expect(metrics.months.length).toBeGreaterThan(0);
    expect(metrics.categories.length).toBeGreaterThan(0);
    expect(metrics.regions.length).toBeGreaterThan(0);
    expect(metrics.products.length).toBeGreaterThan(0);
  });

  it('reports duplicate rows and enforces unique field names', () => {
    const dataset = makeRetailSample(4);
    const repeated = { ...dataset, rows: [...dataset.rows, dataset.rows[0]] };
    expect(getDataQuality(repeated).duplicates).toBe(1);
    expect(() => renameColumn(dataset, dataset.columns[0].key, dataset.columns[1].name)).toThrow('unique');
  });
});

describe('read-only SQL policy', () => {
  it('allows select, joins, aggregates, CTEs, and keywords inside literals', () => {
    expect(() => validateReadOnlySql("SELECT 'DELETE' AS label FROM orders; -- read only")).not.toThrow();
    expect(() => validateReadOnlySql('WITH totals AS (SELECT region, SUM(sales) AS amount FROM orders GROUP BY region) SELECT * FROM totals')).not.toThrow();
  });

  it('blocks writes, administration, oversized statements, and multiple queries', () => {
    expect(() => validateReadOnlySql('DELETE FROM orders')).toThrow('read-only');
    expect(() => validateReadOnlySql('SELECT 1; DROP TABLE orders')).toThrow('one SQL statement');
    expect(() => validateReadOnlySql('SELECT * FROM orders; UPDATE orders SET sales=0')).toThrow();
    expect(() => validateReadOnlySql('PRAGMA table_info(orders)')).toThrow('read-only');
    expect(() => validateReadOnlySql(`SELECT '${'x'.repeat(10_000)}'`)).toThrow('10,000');
  });
});