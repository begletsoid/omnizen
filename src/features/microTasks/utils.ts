import type {
  MicroTaskOrderUpdatePayload,
  MicroTaskRecord,
  MicroTaskTimerState,
} from './types';

export function buildMicroTaskOrderUpdates(tasks: MicroTaskRecord[]): MicroTaskOrderUpdatePayload[] {
  return tasks.map((task, index) => ({
    id: task.id,
    order: index + 1,
  }));
}

export function formatDuration(totalSeconds?: number | null): string {
  const numericValue =
    typeof totalSeconds === 'number' && Number.isFinite(totalSeconds) ? totalSeconds : 0;
  const safeSeconds = Math.max(0, Math.floor(numericValue));
  const hours = Math.floor(safeSeconds / 3600);
  const minutesValue = Math.floor((safeSeconds % 3600) / 60);
  const minutes = hours > 0 ? minutesValue.toString().padStart(2, '0') : minutesValue.toString();
  const seconds = Math.floor(safeSeconds % 60)
    .toString()
    .padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${minutes}:${seconds}`;
  }
  return `${minutes}:${seconds}`;
}

export function normalizeTimerState(state: MicroTaskTimerState | null | undefined) {
  if (state === 'paused' || state === 'running' || state === 'never') {
    return state;
  }
  return 'never';
}

export function parseDurationInput(value: string): number | null {
  if (!value) return null;
  const cleaned = value.trim();
  if (!cleaned) return null;
  const parts = cleaned.split(':');
  if (parts.some((part) => part.trim() === '' || Number.isNaN(Number(part)))) {
    return null;
  }
  let seconds = 0;
  if (parts.length === 1) {
    seconds = Number(parts[0]);
  } else if (parts.length === 2) {
    seconds = Number(parts[0]) * 60 + Number(parts[1]);
  } else if (parts.length === 3) {
    seconds = Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  } else {
    return null;
  }
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return seconds;
}

