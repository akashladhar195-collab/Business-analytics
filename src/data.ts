import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export type FieldType = 'number' | 'date' | 'text';
export type CellValue = string | number | null;
export type DataRow = Record<string, CellValue>;
export type ColumnInfo = { key: string; name: string; type: FieldType; missing: number };
export type Dataset = {
  id: string;
  name: string;
  tableName: string;
  columns: ColumnInfo[];
  rows: DataRow[];
  mappings: { revenue?: string; cost?: string; profit?: string; category?: string; date?: string; region?: string; product?: string };
  isSynthetic: boolean;
  createdAt: string;
};

export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_ROWS = 25_000;
export const MAX_COLUMNS = 80;

const aliases = {
  revenue: ['revenue', 'sales', 'amount'],
  cost: ['cost', 'expense', 'spend'],
  profit: ['profit'],
  category: ['category', 'segment', 'type'],
  date: ['date', 'month', 'day', 'time'],
  region: ['region', 'country', 'state', 'city', 'territory'],
  product: ['product', 'item', 'sku', 'service'],
} as const;

function uniqueHeaders(headers: unknown[]) {
  const seen = new Map<string, number>();
  return headers.map((header, index) => {
    const base = String(header ?? '').trim() || `Column ${index + 1}`;
    const count = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), count);
    return count === 1 ? base : `${base} ${count}`;
  });
}

function parseNumeric(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parenthesized = /^\((.+)\)$/.exec(trimmed);
  const normalized = (parenthesized ? `-${parenthesized[1]}` : trimmed).replace(/[$£€¥,\s%]/g, '');
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function inferType(header: string, values: string[]): FieldType {
  const present = values.filter(Boolean).slice(0, 100);
  if (!present.length) return 'text';
  const dateLikeName = aliases.date.some((term) => header.toLowerCase().includes(term));
  const numberRatio = present.filter((value) => parseNumeric(value) !== null).length / present.length;
  const dateRatio = present.filter((value) => !Number.isNaN(Date.parse(value)) && /[-/:T]/.test(value)).length / present.length;
  if (dateLikeName && dateRatio >= 0.6) return 'date';
  if (numberRatio >= 0.85) return 'number';
  if (dateRatio >= 0.85) return 'date';
  return 'text';
}

function makeDataset(name: string, matrix: unknown[][], isSynthetic = false): Dataset {
  if (matrix.length < 2) throw new Error('The file needs a header row and at least one data row.');
  const headers = uniqueHeaders(matrix[0] ?? []);
  if (!headers.length || headers.length > MAX_COLUMNS) throw new Error(`Use between 1 and ${MAX_COLUMNS} columns.`);
  const rawRows = matrix.slice(1).filter((row) => row.some((value) => String(value ?? '').trim() !== ''));
  if (!rawRows.length) throw new Error('No data rows were found below the header.');
  if (rawRows.length > MAX_ROWS) throw new Error(`This file has more than ${MAX_ROWS.toLocaleString()} rows. Split it into smaller files and try again.`);

  const columns = headers.map((header, index) => {
    const values = rawRows.map((row) => String(row[index] ?? '').trim());
    const type = inferType(header, values);
    const invalidNumbers = type === 'number' ? values.filter((value) => value && parseNumeric(value) === null).length : 0;
    return { key: `c${index}`, name: header, type, missing: values.filter((value) => !value).length + invalidNumbers } satisfies ColumnInfo;
  });
  const rows = rawRows.map((row) => Object.fromEntries(columns.map((column, index) => {
    const value = String(row[index] ?? '').trim();
    return [column.key, value === '' ? null : column.type === 'number' ? parseNumeric(value) : value];
  })));
  const lowerNames = columns.map((column) => [column.key, column.name.toLowerCase()] as const);
  const mapping = (terms: readonly string[]) => lowerNames.find(([, label]) => terms.some((term) => label.includes(term)))?.[0];
  return {
    id: crypto.randomUUID(),
    name: name.replace(/\.[^.]+$/, ''),
    tableName: `dataset_${crypto.randomUUID().replaceAll('-', '')}`,
    columns,
    rows,
    mappings: {
      revenue: mapping(aliases.revenue), cost: mapping(aliases.cost), profit: mapping(aliases.profit),
      category: mapping(aliases.category), date: mapping(aliases.date), region: mapping(aliases.region), product: mapping(aliases.product),
    },
    isSynthetic,
    createdAt: new Date().toISOString(),
  };
}

export async function importDataset(file: File): Promise<Dataset> {
  if (file.size > MAX_FILE_BYTES) throw new Error('Files must be 15 MB or smaller.');
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!extension || !['csv', 'xlsx', 'xls'].includes(extension)) throw new Error('Choose a CSV or Excel file (.csv, .xlsx, .xls).');

  if (extension === 'csv') {
    const result = await new Promise<Papa.ParseResult<string[]>>((resolve, reject) => {
      Papa.parse<string[]>(file, {
        skipEmptyLines: 'greedy',
        complete: resolve,
        error: (error) => reject(new Error(`Could not read CSV: ${error.message}`)),
      });
    });
    const firstError = result.errors.find((error) => error.code !== 'TooFewFields');
    if (firstError) throw new Error(`CSV parsing stopped at row ${(firstError.row ?? 0) + 1}: ${firstError.message}`);
    return makeDataset(file.name, result.data);
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) throw new Error('The workbook does not contain a readable sheet.');
  const range = firstSheet['!ref'] ? XLSX.utils.decode_range(firstSheet['!ref']) : null;
  if (range && range.e.c >= MAX_COLUMNS) throw new Error(`Use no more than ${MAX_COLUMNS} columns.`);
  if (range && range.e.r > MAX_ROWS) throw new Error(`This sheet has more than ${MAX_ROWS.toLocaleString()} data rows.`);
  return makeDataset(file.name, XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1, defval: '', raw: false }));
}

export function getDataQuality(dataset: Dataset) {
  const missing = dataset.columns.reduce((sum, column) => sum + column.missing, 0);
  const uniqueRows = new Set(dataset.rows.map((row) => JSON.stringify(dataset.columns.map((column) => row[column.key])))).size;
  return { missing, duplicates: dataset.rows.length - uniqueRows, completeRows: dataset.rows.length };
}

export function renameColumn(dataset: Dataset, key: string, name: string): Dataset {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Column names cannot be empty.');
  if (dataset.columns.some((column) => column.key !== key && column.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error('Each column needs a unique name.');
  }
  return { ...dataset, columns: dataset.columns.map((column) => column.key === key ? { ...column, name: trimmed } : column) };
}

export function makeRetailSample(count = 480): Dataset {
  const categories: Array<{ category: string; products: Array<[string, number, number]> }> = [
    { category: 'Home', products: [['Linen duvet set', 88, 39], ['Ceramic table lamp', 64, 27], ['Oak serving board', 42, 16]] },
    { category: 'Technology', products: [['Wireless speaker', 129, 78], ['Desk charging hub', 54, 28], ['Studio headphones', 178, 102]] },
    { category: 'Apparel', products: [['Canvas field jacket', 118, 52], ['Everyday carry tote', 38, 12], ['Merino travel scarf', 72, 31]] },
    { category: 'Food', products: [['Single-origin coffee', 24, 11], ['Olive oil duo', 36, 16], ['Pantry tasting box', 58, 25]] },
  ];
  const regions = ['Northeast', 'Southeast', 'Midwest', 'West'];
  const matrix: unknown[][] = [['order_id', 'order_date', 'region', 'category', 'product', 'quantity', 'sales', 'cost', 'discount']];
  for (let index = 0; index < count; index += 1) {
    const group = categories[(index * 7 + Math.floor(index / 9)) % categories.length];
    const product = group.products[(index * 3 + Math.floor(index / 5)) % group.products.length];
    const quantity = 1 + ((index * 13 + Math.floor(index / 4)) % 8);
    const discount = [0, 0.05, 0.1, 0.15, 0.2][(index * 7) % 5];
    const month = (index * 5 + Math.floor(index / 11)) % 24;
    const date = new Date(Date.UTC(2024 + Math.floor(month / 12), month % 12, 1 + ((index * 11) % 27)));
    const gross = product[1] * quantity;
    const sales = gross * (1 - discount);
    const cost = product[2] * quantity;
    matrix.push([
      `ORD-${String(index + 1).padStart(5, '0')}`,
      date.toISOString().slice(0, 10),
      regions[(index * 3 + Math.floor(index / 7)) % regions.length],
      group.category,
      product[0],
      quantity,
      Number(sales.toFixed(2)),
      Number(cost.toFixed(2)),
      discount,
    ]);
  }
  return makeDataset('Synthetic retail sample', matrix, true);
}

export function exportCsv(dataset: Dataset, rows = dataset.rows) {
  const data = rows.map((row) => Object.fromEntries(dataset.columns.map((column) => [column.name, row[column.key] ?? ''])));
  return Papa.unparse(data, { quotes: true });
}

export function downloadText(filename: string, content: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value || 0);
}

export function calculateMetrics(dataset: Dataset) {
  const revenueKey = dataset.mappings.revenue;
  const costKey = dataset.mappings.cost;
  const profitKey = dataset.mappings.profit;
  const numericKeys = dataset.columns.filter((column) => column.type === 'number').map((column) => column.key);
  const sum = (key?: string) => key ? dataset.rows.reduce((total, row) => total + (typeof row[key] === 'number' ? row[key] as number : 0), 0) : 0;
  const revenue = sum(revenueKey);
  const cost = sum(costKey);
  const profit = profitKey ? sum(profitKey) : revenueKey && costKey ? revenue - cost : 0;
  const dateKey = dataset.mappings.date;
  const monthMap = new Map<string, number>();
  if (dateKey && revenueKey) {
    for (const row of dataset.rows) {
      const month = String(row[dateKey] ?? '').slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(month)) monthMap.set(month, (monthMap.get(month) ?? 0) + Number(row[revenueKey] ?? 0));
    }
  }
  const sumBy = (fieldKey?: string) => {
    const groups = new Map<string, number>();
    if (!fieldKey || !revenueKey) return [];
    for (const row of dataset.rows) {
      const label = String(row[fieldKey] ?? '(blank)');
      groups.set(label, (groups.get(label) ?? 0) + Number(row[revenueKey] ?? 0));
    }
    return [...groups.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
  };
  const categories = sumBy(dataset.mappings.category);
  const regions = sumBy(dataset.mappings.region);
  const products = sumBy(dataset.mappings.product);
  const groups = categories.length ? categories : products.length ? products : regions;
  return {
    revenue, cost, profit, margin: revenue ? profit / revenue * 100 : 0,
    recordCount: dataset.rows.length,
    months: [...monthMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, value]) => ({ month, value })),
    groups, categories, regions, products,
    numericKeys,
    hasRevenue: Boolean(revenueKey),
    hasProfit: Boolean(profitKey || (revenueKey && costKey)),
  };
}