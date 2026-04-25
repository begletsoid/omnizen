export type RitualStepType = 'reminder' | 'scale' | 'trio';

export type RitualStep = {
  id: string;
  type: RitualStepType;
  prompt: string;
};

export type RitualSet = {
  id: string;
  name: string;
  steps: RitualStep[];
};

export type TrioValue = 'yes' | 'mid' | 'no';

export type RitualAnswer = number | TrioValue;

export type RitualSetState = {
  stepIndex: number;
  values: Record<string, RitualAnswer>;
};

export type RitualState = {
  dayKey: string;
  activeSetId: string | null;
  answers: Record<string, RitualSetState>;
};

export type RitualConfig = {
  title?: string;
  sets?: RitualSet[];
  state?: RitualState;
  collapsed?: boolean;
};

export const RITUAL_MAX_SETS = 4;
