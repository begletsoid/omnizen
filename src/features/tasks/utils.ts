import type { GoalRecord } from './types';

function efficiency(goal: GoalRecord): number {
  if (!goal.expected_hours || goal.expected_hours === 0) return Infinity;
  return goal.value / goal.expected_hours;
}

function isUnfilled(goal: GoalRecord): boolean {
  return goal.value === 0 || goal.expected_hours === 0;
}

function sortGroup(group: GoalRecord[]): GoalRecord[] {
  return [...group].sort((a, b) => {
    const aUnfilled = isUnfilled(a);
    const bUnfilled = isUnfilled(b);
    if (aUnfilled && !bUnfilled) return -1;
    if (!aUnfilled && bUnfilled) return 1;
    return efficiency(b) - efficiency(a);
  });
}

export function sortGoals(goals: GoalRecord[]): GoalRecord[] {
  const recurring: GoalRecord[] = [];
  const active: GoalRecord[] = [];
  const done: GoalRecord[] = [];
  const locked: GoalRecord[] = [];

  for (const goal of goals) {
    if (goal.is_recurring && !goal.is_done) {
      recurring.push(goal);
    } else if (goal.is_done) {
      done.push(goal);
    } else if (goal.is_locked) {
      locked.push(goal);
    } else {
      active.push(goal);
    }
  }

  return [
    ...sortGroup(recurring),
    ...sortGroup(active),
    ...sortGroup(done),
    ...sortGroup(locked),
  ];
}

export function computeEfficiency(value: number, expectedHours: number): string {
  if (!expectedHours || expectedHours === 0) return '—';
  return String(Math.round(value / expectedHours));
}

export function placeCompletedGoalOrder(goals: GoalRecord[], completedId: string): string[] {
  const completed = goals.find((g) => g.id === completedId);
  if (!completed) return goals.map((g) => g.id);

  const rest = goals.filter((g) => g.id !== completedId);

  let insertAt = rest.length;
  const firstDone = rest.findIndex((g) => g.is_done);
  if (firstDone !== -1) {
    insertAt = firstDone;
  } else {
    const firstLocked = rest.findIndex((g) => g.is_locked && !g.is_done);
    if (firstLocked !== -1) insertAt = firstLocked;
  }

  return [
    ...rest.slice(0, insertAt).map((g) => g.id),
    completed.id,
    ...rest.slice(insertAt).map((g) => g.id),
  ];
}
