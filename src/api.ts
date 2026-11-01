import type { Dataset } from './data';
import { listCharts, listDatasets, saveChart as persistChart, type SavedChart } from './storage';
import { saveCloudRecord, supabase } from './supabase';

export { formatCurrency } from './data';
export type { Dataset } from './data';

export type QueryResult = { columns: string[]; rows: Array<Record<string, string | number | null>>; truncated: boolean };

export function runWorkspaceSql(sql: string, datasets: Dataset[]): Promise<QueryResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./sql.worker.ts', import.meta.url), { type: 'module' });
    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(new Error('Query exceeded the 5-second execution limit. Try a narrower filter or a smaller dataset.'));
    }, 5_000);
    worker.onmessage = (event: MessageEvent<QueryResult | { error: string }>) => {
      window.clearTimeout(timeout);
      worker.terminate();
      if ('error' in event.data) reject(new Error(event.data.error));
      else resolve(event.data);
    };
    worker.onerror = (event) => {
      window.clearTimeout(timeout);
      worker.terminate();
      reject(new Error(event.message || 'The isolated SQL worker failed.'));
    };
    worker.postMessage({ sql, datasets });
  });
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (path === '/datasets' && (!init || init.method === 'GET')) {
    return { datasets: await listDatasets() } as T;
  }
  if (path === '/charts' && (!init || init.method === 'GET')) {
    const localCharts = await listCharts();
    if (!supabase) return { charts: localCharts } as T;
    const { data: { user }, error: sessionError } = await supabase.auth.getUser();
    if (sessionError || !user) return { charts: localCharts } as T;
    const { data: cloudCharts, error } = await supabase.from('saved_charts').select('id,name,dataset_id,config,created_at').eq('user_id', user.id);
    if (error) throw new Error(error.message);
    const charts: SavedChart[] = (cloudCharts ?? []).map((chart) => ({
      id: chart.id,
      name: chart.name,
      datasetId: chart.dataset_id ?? '',
      config: chart.config as Record<string, string>,
      createdAt: chart.created_at,
    }));
    await Promise.all(charts.map((chart) => persistChart(chart)));
    const merged = new Map([...localCharts, ...charts].map((chart) => [chart.id, chart]));
    return { charts: [...merged.values()] } as T;
  }
  if (path === '/charts' && init?.method === 'POST') {
    const body = JSON.parse(String(init.body ?? '{}')) as Omit<SavedChart, 'id' | 'createdAt'>;
    if (!body.name.trim() || !body.datasetId) throw new Error('Choose a chart name and dataset before saving.');
    const chart = { ...body, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    await persistChart(chart);
    if (supabase) {
      const { data: { user }, error: sessionError } = await supabase.auth.getUser();
      if (sessionError) throw new Error(sessionError.message);
      if (user) await saveCloudRecord('saved_charts', {
        id: chart.id, user_id: user.id, dataset_id: chart.datasetId, name: chart.name, config: chart.config, created_at: chart.createdAt,
      });
    }
    return {} as T;
  }
  if (path === '/sql' && init?.method === 'POST') {
    const body = JSON.parse(String(init.body ?? '{}')) as { sql: string; datasetId: string };
    const datasets = await listDatasets();
    if (!datasets.some((dataset) => dataset.id === body.datasetId)) throw new Error('The selected dataset is no longer available.');
    return await runWorkspaceSql(body.sql, datasets) as T;
  }
  throw new Error('This workspace action is not available.');
}