/**
 * Quick-switcher data layer. This is the Electron overlay window's source
 * of truth for "all in-progress micro-tasks of the current user".
 *
 * The regular `getMicroTasks(widgetId)` is scoped to a single widget — but
 * the overlay needs to span ALL of the user's micro-task widgets, flatly,
 * so they can jump between unrelated streams of work with one keystroke.
 * We select directly off `micro_tasks` filtered by user_id + status flags,
 * plus the user's `micro_task_groups` so the client can replay the same
 * sort order the dashboard widget uses (free tasks first, then groups in
 * group.order, then tasks inside groups in group_order).
 */

import { supabase } from '../../lib/supabaseClient';
import {
  buildFlatList,
  extractId,
  isTaskId,
} from '../../widgets/microTasks/utils/dndUtils';
import type { MicroTaskGroup, MicroTaskRecord } from '../microTasks/types';

let supabaseClient = supabase;

function requireSupabase() {
  if (!supabaseClient) throw new Error('Supabase client unavailable');
  return supabaseClient;
}

/**
 * Flattens tasks into the EXACT top-to-bottom order the dashboard widget
 * renders them. We deliberately reuse `buildFlatList` from `dndUtils` —
 * the same function `MicroTasksWidget` uses — so there is a single source
 * of truth. Groups and ungrouped tasks interleave by a shared `order`
 * field (a group sits at `group.order`, an ungrouped task at
 * `task.order`); within a group, tasks are ordered by `group_order`.
 *
 * The overlay spans multiple widgets, so we run `buildFlatList` once per
 * widget and concatenate (widgets ordered by id for stability — the user
 * realistically has one micro-task widget).
 *
 * Pure for testability.
 */
export function sortTasksLikeWidget(
  tasks: MicroTaskRecord[],
  groups: MicroTaskGroup[],
): MicroTaskRecord[] {
  const tasksByWidget = new Map<string, MicroTaskRecord[]>();
  for (const t of tasks) {
    const arr = tasksByWidget.get(t.widget_id) ?? [];
    arr.push(t);
    tasksByWidget.set(t.widget_id, arr);
  }
  const groupsByWidget = new Map<string, MicroTaskGroup[]>();
  for (const g of groups) {
    const arr = groupsByWidget.get(g.widget_id) ?? [];
    arr.push(g);
    groupsByWidget.set(g.widget_id, arr);
  }

  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const widgetIds = [...tasksByWidget.keys()].sort();
  const result: MicroTaskRecord[] = [];
  for (const widgetId of widgetIds) {
    const wTasks = tasksByWidget.get(widgetId) ?? [];
    const wGroups = groupsByWidget.get(widgetId) ?? [];
    for (const entry of buildFlatList(wTasks, wGroups)) {
      if (!isTaskId(entry)) continue; // skip group head / gend markers
      const task = taskById.get(extractId(entry));
      if (task) result.push(task);
    }
  }
  return result;
}

/**
 * Returns every active micro-task of the user across all widgets, sorted
 * deterministically so the 1-9 keyboard shortcuts stick to the same task
 * between renders. "Active" means: not archived AND not done.
 *
 * The SELECT shape mirrors `getMicroTasks` so callers can reuse all the
 * existing helpers (`computeTaskSeconds`, `getCategoryColorPreset`, etc.).
 *
 * Groups are fetched in parallel and used to mimic the dashboard widget's
 * visual order — see `sortTasksLikeWidget`.
 */
export async function getActiveMicroTasksForUser(userId: string): Promise<MicroTaskRecord[]> {
  const client = requireSupabase();
  const [tasksRes, groupsRes] = await Promise.all([
    client
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
      .eq('user_id', userId)
      .eq('is_done', false)
      .is('archived_at', null),
    client
      .from('micro_task_groups')
      .select('*')
      .eq('user_id', userId),
  ]);
  if (tasksRes.error) throw tasksRes.error;
  if (groupsRes.error) throw groupsRes.error;

  type RawTagLink = { task_tags: { id: string; name: string; user_id: string; created_at: string; updated_at: string } };
  type RawCategoryLink = {
    task_categories: {
      id: string;
      name: string;
      is_auto: boolean;
      color: string | null;
      user_id: string;
      created_at: string;
      updated_at: string;
      source_tag_id: string | null;
      tags?: RawTagLink[];
    };
  };
  type RawTask = Omit<MicroTaskRecord, 'categories'> & { categories?: RawCategoryLink[] };

  const tasks = (tasksRes.data ?? []).map((task) => {
    const raw = task as RawTask;
    return {
      ...raw,
      elapsed_seconds: raw.elapsed_seconds ?? 0,
      group_id: raw.group_id ?? null,
      group_order: typeof raw.group_order === 'number' ? raw.group_order : null,
      categories:
        raw.categories?.map((link) => ({
          id: link.task_categories.id,
          name: link.task_categories.name,
          is_auto: link.task_categories.is_auto,
          color: link.task_categories.color,
          user_id: link.task_categories.user_id,
          created_at: link.task_categories.created_at,
          updated_at: link.task_categories.updated_at,
          source_tag_id: link.task_categories.source_tag_id,
          tags: link.task_categories.tags?.map((tagLink) => tagLink.task_tags) ?? [],
        })) ?? [],
    } satisfies MicroTaskRecord;
  });

  return sortTasksLikeWidget(tasks, (groupsRes.data ?? []) as MicroTaskGroup[]);
}

export function __setSupabaseClient(client: typeof supabase) {
  supabaseClient = client;
}
