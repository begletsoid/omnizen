import { supabase } from '../../lib/supabaseClient';
import type {
  AnalyticsSettingsUpsert,
  AnalyticsTimerInsert,
  AnalyticsTimerUpdate,
  CompletedTaskWithCategories,
} from './types';

let supabaseClient = supabase;

if (!supabaseClient) {
  console.warn('Supabase client unavailable - analytics API disabled.');
}

export function __setSupabaseClient(client: typeof supabase) {
  supabaseClient = client;
}

function requireSupabase() {
  if (!supabaseClient) throw new Error('Supabase client unavailable');
  return supabaseClient;
}

export async function getAnalyticsSettings(userId: string) {
  const client = requireSupabase();
  return client.from('analytics_settings').select('*').eq('user_id', userId).maybeSingle();
}

export async function upsertAnalyticsSettings(userId: string, payload: AnalyticsSettingsUpsert) {
  const client = requireSupabase();
  return client
    .from('analytics_settings')
    .upsert(
      {
        user_id: userId,
        period_start: payload.period_start,
        period_end: payload.period_end,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
    .select('*')
    .single();
}

export async function listAnalyticsTimers(userId: string) {
  const client = requireSupabase();
  return client.from('analytics_timers').select('*').eq('user_id', userId).order('sort_order', { ascending: true });
}

export async function createAnalyticsTimer(userId: string, payload: AnalyticsTimerInsert) {
  const client = requireSupabase();
  return client
    .from('analytics_timers')
    .insert({
      user_id: userId,
      name: payload.name,
      color: payload.color ?? null,
      days_mask: payload.days_mask ?? '1111111',
      tag_ids: payload.tag_ids ?? [],
      category_ids: payload.category_ids ?? [],
      sort_order: payload.sort_order,
    })
    .select('*')
    .single();
}

export async function updateAnalyticsTimer(timerId: string, payload: AnalyticsTimerUpdate) {
  const client = requireSupabase();
  return client
    .from('analytics_timers')
    .update({
      ...payload,
      updated_at: new Date().toISOString(),
    })
    .eq('id', timerId)
    .select('*')
    .single();
}

export async function deleteAnalyticsTimer(timerId: string) {
  const client = requireSupabase();
  return client.from('analytics_timers').delete().eq('id', timerId);
}

export type CompletedTasksParams = {
  userId: string;
  from?: string; // inclusive UTC datetime ISO
  to?: string; // inclusive UTC datetime ISO
  limit?: number;
  offset?: number;
};

export async function listCompletedTasksWithCategories(params: CompletedTasksParams) {
  const client = requireSupabase();
  const query = client
    .from('micro_tasks')
    .select(
      `
      id,
      user_id,
      title,
      is_done,
      elapsed_seconds,
      created_at,
      updated_at,
      categories:task_category_links(task_categories(
        id,
        name,
        is_auto,
        color,
        created_at,
        updated_at,
        tags:category_tags(task_tags(id, name, created_at, updated_at, user_id))
      ))
    `,
    )
    .eq('is_done', true)
    .eq('user_id', params.userId)
    .order('created_at', { ascending: false });

  if (params.from) {
    query.gte('created_at', params.from);
  }
  if (params.to) {
    query.lte('created_at', params.to);
  }
  if (typeof params.offset === 'number') {
    query.range(params.offset, (params.offset ?? 0) + (params.limit ?? 50) - 1);
  } else if (params.limit) {
    query.limit(params.limit);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((task: any) => ({
    ...task,
    categories:
      task.categories?.map((link: any) => ({
        id: link.task_categories.id,
        name: link.task_categories.name,
        is_auto: link.task_categories.is_auto,
        color: link.task_categories.color,
        tags:
          link.task_categories.tags?.map((tagLink: any) => ({
            id: tagLink.task_tags.id,
            name: tagLink.task_tags.name,
            user_id: tagLink.task_tags.user_id,
            created_at: tagLink.task_tags.created_at,
            updated_at: tagLink.task_tags.updated_at,
          })) ?? [],
      })) ?? [],
  })) as CompletedTaskWithCategories[];
}
