export type MicroTaskTimerState = 'never' | 'paused' | 'running';

export type MicroTaskRecord = {
  id: string;
  widget_id: string;
  user_id: string;
  title: string;
  is_done: boolean;
  order: number;
  elapsed_seconds: number;
  timer_state: MicroTaskTimerState;
  last_started_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  categories?: TaskCategory[];
};

export type MicroTaskInsert = {
  title: string;
  widget_id: string;
  user_id?: string;
  order?: number;
  is_done?: boolean;
  elapsed_seconds?: number;
  timer_state?: MicroTaskTimerState;
  last_started_at?: string | null;
  archived_at?: string | null;
};

export type MicroTaskUpdate = Partial<
  Pick<
    MicroTaskRecord,
    | 'title'
    | 'is_done'
    | 'order'
    | 'elapsed_seconds'
    | 'timer_state'
    | 'last_started_at'
    | 'archived_at'
  >
>;

export type MicroTaskOrderUpdatePayload = Pick<MicroTaskRecord, 'id' | 'order'>;

export type TaskTag = {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export type TaskCategory = {
  id: string;
  user_id: string;
  name: string;
  is_auto: boolean;
  color?: string | null;
  source_tag_id?: string | null;
  created_at: string;
  updated_at: string;
  tags?: TaskTag[];
};

export type TaskCategoryLink = {
  task_id: string;
  category_id: string;
};

export type TaskCategoryBuffer = {
  user_id: string;
  category_ids: string[];
  updated_at: string;
};

