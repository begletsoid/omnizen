import { supabase } from '../../lib/supabaseClient';
import type {
  MicroTaskInsert,
  MicroTaskOrderUpdatePayload,
  MicroTaskRecord,
  MicroTaskUpdate,
  MicroTaskGroup,
  MicroTaskGroupOrderUpdatePayload,
  MicroTaskGroupTemplate,
  MicroTaskGroupTemplateItem,
  MicroTaskGroupTaskUpdatePayload,
  TaskCategory,
  TaskCategoryBuffer,
  TaskTag,
} from './types';

let supabaseClient = supabase;

if (!supabaseClient) {
  console.warn('Supabase client unavailable - micro tasks API disabled.');
}

export function __setSupabaseClient(client: typeof supabase) {
  supabaseClient = client;
}

function requireSupabase() {
  if (!supabaseClient) throw new Error('Supabase client unavailable');
  return supabaseClient;
}

export async function getMicroTasks(widgetId: string) {
  const client = requireSupabase();
  return client
    .from('micro_tasks')
    .select(
      `*, categories:task_category_links(task_categories(
        id,
        name,
        is_auto,
        color,
        user_id,
        created_at,
        updated_at,
        source_tag_id,
        tags:category_tags(task_tags(id, name, created_at, updated_at, user_id))
      ))`,
    )
    .eq('widget_id', widgetId)
    .is('archived_at', null)
    .order('order', { ascending: true });
}

export async function getMicroTaskGroups(widgetId: string) {
  const client = requireSupabase();
  return client
    .from('micro_task_groups')
    .select('*')
    .eq('widget_id', widgetId)
    .order('order', { ascending: true });
}

export async function createMicroTaskGroup(payload: Pick<MicroTaskGroup, 'widget_id' | 'user_id' | 'name' | 'order'>) {
  const client = requireSupabase();
  return client.from('micro_task_groups').insert(payload).select('*').single();
}

export async function updateMicroTaskGroup(id: string, payload: Partial<Pick<MicroTaskGroup, 'name' | 'order'>>) {
  const client = requireSupabase();
  return client.from('micro_task_groups').update(payload).eq('id', id).select('*').single();
}

export async function deleteMicroTaskGroup(id: string) {
  const client = requireSupabase();
  return client.from('micro_task_groups').delete().eq('id', id);
}

export async function listMicroTaskGroupTemplates(userId: string) {
  const client = requireSupabase();
  const { data, error } = await client
    .from('micro_task_group_templates')
    .select('*')
    .eq('user_id', userId)
    .order('name');
  if (error) throw error;
  return (data ?? []) as MicroTaskGroupTemplate[];
}

export async function listMicroTaskGroupTemplateItems(templateId: string) {
  const client = requireSupabase();
  const { data, error } = await client
    .from('micro_task_group_template_items')
    .select('*')
    .eq('template_id', templateId)
    .order('order');
  if (error) throw error;
  return (data ?? []) as MicroTaskGroupTemplateItem[];
}

export async function createMicroTaskGroupTemplate(payload: Pick<MicroTaskGroupTemplate, 'user_id' | 'name'>) {
  const client = requireSupabase();
  return client
    .from('micro_task_group_templates')
    .upsert(payload, { onConflict: 'user_id,name' })
    .select('*')
    .single();
}

export async function createMicroTaskGroupTemplateItems(
  templateId: string,
  items: Array<Pick<MicroTaskGroupTemplateItem, 'title' | 'category_ids' | 'order'>>,
) {
  const client = requireSupabase();
  if (!items.length) return { data: [], error: null };
  return client
    .from('micro_task_group_template_items')
    .insert(
      items.map((item) => ({
        template_id: templateId,
        title: item.title,
        category_ids: item.category_ids,
        order: item.order,
      })),
    )
    .select('*');
}

export async function replaceMicroTaskGroupTemplateItems(
  templateId: string,
  items: Array<Pick<MicroTaskGroupTemplateItem, 'title' | 'category_ids' | 'order'>>,
) {
  const client = requireSupabase();
  const { error: deleteError } = await client
    .from('micro_task_group_template_items')
    .delete()
    .eq('template_id', templateId);
  if (deleteError) throw deleteError;
  return createMicroTaskGroupTemplateItems(templateId, items);
}

export async function deleteMicroTaskGroupTemplate(templateId: string, userId: string) {
  const client = requireSupabase();
  const { error } = await client
    .from('micro_task_group_templates')
    .delete()
    .eq('id', templateId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function createMicroTask(payload: MicroTaskInsert) {
  const client = requireSupabase();
  return client.from('micro_tasks').insert(payload).select('*').single();
}

export async function updateMicroTask(id: string, payload: MicroTaskUpdate) {
  const client = requireSupabase();
  return client.from('micro_tasks').update(payload).eq('id', id).select('*').single();
}

export async function deleteMicroTask(id: string) {
  const client = requireSupabase();
  return client.from('micro_tasks').delete().eq('id', id);
}

export async function fetchNextMicroTaskOrder(widgetId: string) {
  const client = requireSupabase();
  const { data, error } = await client
    .from('micro_tasks')
    .select('order')
    .eq('widget_id', widgetId)
    .order('order', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const lastOrder = typeof data?.order === 'number' ? data.order : 0;
  return lastOrder + 1;
}

export async function reorderMicroTasks(params: {
  widgetId: string;
  userId: string;
  updates: MicroTaskOrderUpdatePayload[];
}) {
  const client = requireSupabase();
  if (!params.updates.length) return;
  const { error } = await client.rpc('reorder_micro_tasks', {
    p_widget_id: params.widgetId,
    p_user_id: params.userId,
    p_updates: params.updates,
  });
  if (error) throw error;
}

export async function reorderMicroTaskItems(params: {
  widgetId: string;
  userId: string;
  taskUpdates: MicroTaskGroupTaskUpdatePayload[];
  groupUpdates: MicroTaskGroupOrderUpdatePayload[];
}) {
  const client = requireSupabase();
  const { error } = await client.rpc('reorder_micro_task_items', {
    p_widget_id: params.widgetId,
    p_user_id: params.userId,
    p_task_updates: params.taskUpdates,
    p_group_updates: params.groupUpdates,
  });
  if (error) throw error;
}

export async function startMicroTaskTimer(taskId: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc('start_micro_task_timer', {
    p_task_id: taskId,
  });
  if (error) throw enhanceRpcError(error, 'start_micro_task_timer');
  return data as MicroTaskRecord;
}

export async function pauseMicroTaskTimer(taskId: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc('pause_micro_task_timer', {
    p_task_id: taskId,
  });
  if (error) throw enhanceRpcError(error, 'pause_micro_task_timer');
  return data as MicroTaskRecord;
}

export async function listTaskTags(userId: string) {
  const client = requireSupabase();
  const { data, error } = await client
    .from('task_tags')
    .select('*')
    .eq('user_id', userId)
    .order('name');
  if (error) throw error;
  return (data ?? []) as TaskTag[];
}

export async function createTaskTag(name: string, userId: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc('create_task_tag_with_category', {
    p_name: name,
    p_user_id: userId,
  });
  if (error) throw error;
  return data as { tag: TaskTag; category: TaskCategory };
}

export async function deleteTaskTag(tagId: string, userId: string) {
  const client = requireSupabase();
  const { error } = await client.rpc('delete_task_tag_and_associated_data', {
    p_tag_id: tagId,
    p_user_id: userId,
  });
  if (error) throw error;
}

export async function listTaskCategories(userId: string) {
  const client = requireSupabase();
  const { data, error } = await client
    .from('task_categories')
    .select('*, tags:category_tags(task_tags(id, name, created_at, updated_at, user_id))')
    .eq('user_id', userId)
    .order('name');
  if (error) throw error;
  type RawTagLink = { task_tags: { id: string; name: string; user_id: string; created_at: string; updated_at: string } };
  type RawCategory = Omit<TaskCategory, 'tags'> & { tags?: RawTagLink[] };
  return (data ?? []).map((category) => {
    const raw = category as unknown as RawCategory;
    return {
      ...raw,
      tags:
        raw.tags?.map((link) => ({
          id: link.task_tags.id,
          name: link.task_tags.name,
          user_id: link.task_tags.user_id,
          created_at: link.task_tags.created_at,
          updated_at: link.task_tags.updated_at,
        })) ?? [],
    };
  }) as TaskCategory[];
}

export async function createTaskCategory(name: string, userId: string) {
  const client = requireSupabase();
  const { data, error } = await client
    .from('task_categories')
    .insert({ name, user_id: userId })
    .select('*')
    .single();
  if (error) throw error;
  return data as TaskCategory;
}

export async function updateTaskCategoryAttributes(
  categoryId: string,
  payload: Partial<Pick<TaskCategory, 'name' | 'color'>>,
  userId: string,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from('task_categories')
    .update(payload)
    .eq('id', categoryId)
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error) throw error;
  return data as TaskCategory;
}

export async function deleteTaskCategory(categoryId: string, userId: string) {
  const client = requireSupabase();
  const { error } = await client
    .from('task_categories')
    .delete()
    .eq('id', categoryId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function attachTagToCategory(categoryId: string, tagId: string, userId: string) {
  const client = requireSupabase();
  const { error } = await client.rpc('attach_tag_to_category', {
    p_category_id: categoryId,
    p_tag_id: tagId,
    p_user_id: userId,
  });
  if (error) throw error;
}

export async function detachTagFromCategory(categoryId: string, tagId: string, userId: string) {
  const client = requireSupabase();
  const { error } = await client.rpc('detach_tag_from_category', {
    p_category_id: categoryId,
    p_tag_id: tagId,
    p_user_id: userId,
  });
  if (error) throw error;
}

export async function getTaskCategoryBuffer(userId: string) {
  const client = requireSupabase();
  const { data, error } = await client
    .from('task_category_buffers')
    .select('category_ids')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data?.category_ids ?? []) as TaskCategoryBuffer['category_ids'];
}

export async function setTaskCategoryBuffer(userId: string, categoryIds: string[]) {
  const client = requireSupabase();
  const { error } = await client
    .from('task_category_buffers')
    .upsert({ user_id: userId, category_ids: categoryIds })
    .eq('user_id', userId);
  if (error) throw error;
}

export async function attachCategoriesToTask(taskId: string, categoryIds: string[], userId: string) {
  const client = requireSupabase();
  if (!categoryIds.length) return;
  const { error } = await client.rpc('attach_categories_to_task', {
    p_task_id: taskId,
    p_category_ids: categoryIds,
    p_user_id: userId,
  });
  if (error) throw error;
}

export async function detachCategoryFromTask(taskId: string, categoryId: string, userId: string) {
  const client = requireSupabase();
  const { error } = await client.rpc('detach_category_from_task', {
    p_task_id: taskId,
    p_category_id: categoryId,
    p_user_id: userId,
  });
  if (error) throw error;
}

function enhanceRpcError(
  error: { code?: string; message?: string } & Error,
  functionName: string,
): Error {
  if (error.code === 'PGRST202') {
    return new Error(
      `Supabase RPC "${functionName}" отсутствует. Примените последние миграции (supabase db push) и повторите.`,
    );
  }
  return error;
}
