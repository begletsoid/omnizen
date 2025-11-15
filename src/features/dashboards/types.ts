export type DashboardRecord = {
  id: string;
  user_id: string;
  title: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export type WidgetRecord = {
  id: string;
  dashboard_id: string;
  type: 'habits' | 'problems' | 'tasks' | 'image';
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type WidgetLayoutItem = {
  widget_id: string;
  type: WidgetRecord['type'];
  x: number;
  y: number;
  w: number;
  h: number;
  z?: number;
};

export type WidgetLayoutRecord = {
  id: string;
  dashboard_id: string;
  layout: WidgetLayoutItem[];
  updated_at: string;
};

export type BootstrapResult = {
  dashboard: DashboardRecord;
  widgets: WidgetRecord[];
  layout: WidgetLayoutRecord;
};
