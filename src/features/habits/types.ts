export type HabitStatus = 'adopted' | 'in_progress' | 'not_started';

export type HabitRecord = {
  id: string;
  widget_id: string;
  user_id: string;
  title: string;
  status: HabitStatus;
  order: number;
  created_at: string;
  updated_at: string;
};

export type HabitInsert = {
  widget_id: string;
  title: string;
  status?: HabitStatus;
  order?: number;
  user_id?: string;
};

export type HabitUpdate = Partial<Pick<HabitRecord, 'title' | 'status' | 'order'>>;

export type HabitOrderUpdatePayload = Pick<HabitRecord, 'id' | 'order'> & {
  status?: HabitStatus;
};
