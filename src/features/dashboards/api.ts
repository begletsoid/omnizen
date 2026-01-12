import { supabase } from '../../lib/supabaseClient';
import type {
  BootstrapResult,
  DashboardRecord,
  WidgetLayoutItem,
  WidgetLayoutRecord,
  WidgetRecord,
} from './types';

if (!supabase) {
  console.warn('Supabase client unavailable - dashboard API will be disabled.');
}

const DEFAULT_WIDGETS: Array<{ type: WidgetRecord['type']; config?: Record<string, unknown> }> = [
  { type: 'habits', config: { title: 'Лента привычек' } },
  { type: 'problems', config: { title: 'Проблемы / Решения' } },
  { type: 'tasks', config: { title: 'Микрозадачи' } },
  { type: 'analytics', config: { title: 'Аналитика' } },
  { type: 'image', config: { title: 'Визуальный виджет' } },
];

const DEFAULT_GRID: Array<{ w: number; h: number }> = [
  { w: 4, h: 3 },
  { w: 4, h: 3 },
  { w: 4, h: 3 },
  { w: 4, h: 3 },
];

export async function getDashboards(userId: string) {
  if (!supabase) throw new Error('Supabase client unavailable');
  return supabase.from('dashboards').select('*').eq('user_id', userId);
}

export async function getWidgets(dashboardId: string) {
  if (!supabase) throw new Error('Supabase client unavailable');
  return supabase.from('widgets').select('*').eq('dashboard_id', dashboardId).order('created_at');
}

export async function getLayout(dashboardId: string) {
  if (!supabase) throw new Error('Supabase client unavailable');
  return supabase.from('widget_layouts').select('*').eq('dashboard_id', dashboardId).maybeSingle();
}

export async function saveLayout(dashboardId: string, layout: WidgetLayoutItem[]) {
  if (!supabase) throw new Error('Supabase client unavailable');
  return supabase
    .from('widget_layouts')
    .upsert({ dashboard_id: dashboardId, layout }, { onConflict: 'dashboard_id' })
    .select()
    .single();
}

export async function updateWidgetConfig(widgetId: string, config: Record<string, unknown>) {
  if (!supabase) throw new Error('Supabase client unavailable');
  const { data, error } = await supabase
    .from('widgets')
    .update({ config })
    .eq('id', widgetId)
    .select('*')
    .single();

  if (error) throw error;
  return data as WidgetRecord;
}

export async function bootstrapDashboard(userId: string): Promise<BootstrapResult> {
  if (!supabase) throw new Error('Supabase client unavailable');

  await ensureProfileExists(userId);

  const existingDashboard = await supabase
    .from('dashboards')
    .select('*')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (existingDashboard.error) throw existingDashboard.error;

  let dashboard: DashboardRecord;

  if (existingDashboard.data) {
    dashboard = existingDashboard.data as DashboardRecord;
  } else {
    dashboard = await createDashboard(userId);
  }

  const widgets = await ensureWidgets(dashboard);
  const layout = await ensureLayout(dashboard.id, widgets);

  return { dashboard, widgets, layout };
}

async function ensureProfileExists(userId: string) {
  if (!supabase) throw new Error('Supabase client unavailable');
  const { error } = await supabase.rpc('ensure_profile', { p_user_id: userId });
  if (error) throw error;
}

async function createDashboard(userId: string): Promise<DashboardRecord> {
  if (!supabase) throw new Error('Supabase client unavailable');

  const { data, error } = await supabase
    .from('dashboards')
    .insert({ user_id: userId, title: 'Персональный дашборд', is_default: true })
    .select()
    .single();

  if (error) throw error;
  return data as DashboardRecord;
}

async function ensureWidgets(dashboard: DashboardRecord): Promise<WidgetRecord[]> {
  if (!supabase) throw new Error('Supabase client unavailable');

  const { data: existing, error } = await supabase
    .from('widgets')
    .select('*')
    .eq('dashboard_id', dashboard.id)
    .order('created_at');

  if (error) throw error;
  let widgets: WidgetRecord[] = (existing as WidgetRecord[]) ?? [];

  if (widgets.length) {
    const hasAnalytics = widgets.some((w) => w.type === 'analytics');
    if (!hasAnalytics) {
      const { data: createdAnalytics, error: insertAnalyticsError } = await supabase
        .from('widgets')
        .insert({
          dashboard_id: dashboard.id,
          type: 'analytics',
          config: { title: 'Аналитика' },
        })
        .select('*')
        .single();
      if (insertAnalyticsError) throw insertAnalyticsError;
      widgets = [...widgets, createdAnalytics as WidgetRecord];
    }
    return widgets;
  }

  const inserts = DEFAULT_WIDGETS.map((widget) => ({
    dashboard_id: dashboard.id,
    type: widget.type,
    config: widget.config ?? {},
  }));

  const { data: created, error: insertError } = await supabase
    .from('widgets')
    .insert(inserts)
    .select('*');

  if (insertError) throw insertError;
  return created as WidgetRecord[];
}

async function ensureLayout(dashboardId: string, widgets: WidgetRecord[]): Promise<WidgetLayoutRecord> {
  if (!supabase) throw new Error('Supabase client unavailable');

  const layoutResponse = await supabase
    .from('widget_layouts')
    .select('*')
    .eq('dashboard_id', dashboardId)
    .maybeSingle();

  if (layoutResponse.error && layoutResponse.error.code !== 'PGRST116') {
    throw layoutResponse.error;
  }

  if (layoutResponse.data) {
    const layout = layoutResponse.data as WidgetLayoutRecord;
    const layoutIds = new Set(layout.layout.map((item) => item.widget_id));
    const missing = widgets.filter((w) => !layoutIds.has(w.id));
    if (!missing.length) {
      return layout;
    }
    const startIndex = layout.layout.length;
    const additions = missing.map((widget, idx) => ({
      widget_id: widget.id,
      type: widget.type,
      x: ((startIndex + idx) % 2) * 6,
      y: Math.floor((startIndex + idx) / 2) * 4,
      w: DEFAULT_GRID[startIndex + idx]?.w ?? 4,
      h: DEFAULT_GRID[startIndex + idx]?.h ?? 3,
      z: startIndex + idx,
    }));
    const nextLayout = [...layout.layout, ...additions];
    const { data: updatedLayout, error: updateError } = await supabase
      .from('widget_layouts')
      .update({ layout: nextLayout, updated_at: new Date().toISOString() })
      .eq('id', layout.id)
      .select('*')
      .single();
    if (updateError) throw updateError;
    return updatedLayout as WidgetLayoutRecord;
  }

  const layout = widgets.map((widget, index) => ({
    widget_id: widget.id,
    type: widget.type,
    x: (index % 2) * 6,
    y: Math.floor(index / 2) * 4,
    w: DEFAULT_GRID[index]?.w ?? 4,
    h: DEFAULT_GRID[index]?.h ?? 3,
    z: index,
  } satisfies WidgetLayoutItem));

  const { data, error } = await supabase
    .from('widget_layouts')
    .insert({ dashboard_id: dashboardId, layout })
    .select('*')
    .single();

  if (error) throw error;

  return data as WidgetLayoutRecord;
}
