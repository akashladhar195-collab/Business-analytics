import type { Dataset } from './data';

export type Project = { id: string; name: string; createdAt: string; datasetId?: string };
export type SavedChart = { id: string; name: string; datasetId: string; config: Record<string, string>; createdAt: string };
export type SavedReport = { id: string; title: string; datasetId: string; createdAt: string };

const databaseName = 'insightbi-workspace';
const databaseVersion = 1;
let workspaceNamespace = 'local';

export function setWorkspaceNamespace(userId?: string) {
  workspaceNamespace = userId ? `user-${userId}` : 'local';
}

function openWorkspace() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(`${databaseName}-${workspaceNamespace}`, databaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const store of ['datasets', 'projects', 'charts', 'reports']) {
        if (!database.objectStoreNames.contains(store)) database.createObjectStore(store, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('This browser could not open the local workspace.'));
  });
}

async function request<T>(storeName: string, operation: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openWorkspace();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly');
    const result = operation(transaction.objectStore(storeName));
    result.onsuccess = () => resolve(result.result);
    result.onerror = () => reject(new Error('The local workspace could not be read.'));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(new Error('The local workspace could not be read.'));
  });
}

async function write<T>(storeName: string, operation: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openWorkspace();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    const result = operation(transaction.objectStore(storeName));
    let value: T;
    result.onsuccess = () => { value = result.result; };
    transaction.oncomplete = () => { database.close(); resolve(value!); };
    transaction.onerror = () => { database.close(); reject(new Error('The local workspace could not be saved.')); };
    transaction.onabort = () => { database.close(); reject(new Error('The local workspace could not be saved.')); };
  });
}

export const listDatasets = () => request<Dataset[]>('datasets', (store) => store.getAll());
export const saveDataset = (dataset: Dataset) => write('datasets', (store) => store.put(dataset));
export const removeDataset = (id: string) => write('datasets', (store) => store.delete(id));
export const listProjects = () => request<Project[]>('projects', (store) => store.getAll());
export const saveProject = (project: Project) => write('projects', (store) => store.put(project));
export const removeProject = (id: string) => write('projects', (store) => store.delete(id));
export const listCharts = () => request<SavedChart[]>('charts', (store) => store.getAll());
export const saveChart = (chart: SavedChart) => write('charts', (store) => store.put(chart));
export const listReports = () => request<SavedReport[]>('reports', (store) => store.getAll());
export const saveReport = (report: SavedReport) => write('reports', (store) => store.put(report));