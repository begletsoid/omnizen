export type AnalyticsSettings = {
  user_id: string;
  period_start: string; // date string (YYYY-MM-DD), stored in DB
  period_end: string; // date string (YYYY-MM-DD), stored in DB
  updated_at: string;
};

export type AnalyticsSettingsUpsert = {
  period_start: string;
  period_end: string;
};

export type AnalyticsTimer = {
  id: string;
  user_id: string;
  name: string;
  color: string | null;
  days_mask: string; // bit(7) as string, ISO: Mon bit1 ... Sun bit7
  tag_ids: string[];
  category_ids: string[];
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type AnalyticsTimerInsert = {
  name: string;
  color?: string | null;
  days_mask?: string;
  tag_ids?: string[];
  category_ids?: string[];
  sort_order: number;
};

export type AnalyticsTimerUpdate = Partial<
  Pick<AnalyticsTimer, 'name' | 'color' | 'days_mask' | 'tag_ids' | 'category_ids' | 'sort_order'>
>;

export type CompletedTaskWithCategories = {
  id: string;
  widget_id: string;
  user_id: string;
  title: string;
  is_done: boolean;
  elapsed_seconds: number;
  created_at: string;
  updated_at: string;
  categories: Array<{
    id: string;
    name: string;
    is_auto: boolean;
    color: string | null;
    tags: Array<{
      id: string;
      name: string;
      user_id: string;
      created_at: string;
      updated_at: string;
    }>;
  }>;
};
