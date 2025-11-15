export type LayoutItem = {
  widget_id: string;
  type: 'habits' | 'problems' | 'tasks' | 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  z?: number;
};

export type LayoutRecord = {
  id: string;
  dashboard_id: string;
  layout: LayoutItem[];
  updated_at: string;
};
