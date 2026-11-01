import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;
export const cloudAuthEnabled = Boolean(supabase);

export async function saveCloudRecord(table: 'projects' | 'datasets' | 'saved_charts' | 'reports', record: Record<string, unknown>) {
  if (!supabase) return;
  const { error } = await supabase.from(table).upsert(record);
  if (error) throw new Error(error.message);
}

export async function deleteCloudRecord(table: 'projects' | 'datasets', id: string) {
  if (!supabase) return;
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function syncCloudMetadata(userId: string) {
  if (!supabase) return;
  const results = await Promise.all([
    supabase.from('projects').select('id,name,created_at,dataset_id').eq('user_id', userId),
    supabase.from('datasets').select('id,name,table_name,row_count,columns,mappings,is_synthetic,created_at,project_id').eq('user_id', userId),
    supabase.from('saved_charts').select('id,name,dataset_id,config,created_at').eq('user_id', userId),
    supabase.from('reports').select('id,title,dataset_id,created_at').eq('user_id', userId),
  ]);
  const errors = results.flatMap(({ error }) => error ? [error.message] : []);
  if (errors.length) throw new Error(errors.join('. '));
  return {
    projects: results[0].data ?? [],
    datasets: results[1].data ?? [],
    charts: results[2].data ?? [],
    reports: results[3].data ?? [],
  };
}