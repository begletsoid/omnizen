import { CronExpressionParser } from 'cron-parser';
import type { RecurringGoalRecord } from './types';

export type PendingTrigger = {
  recurringGoal: RecurringGoalRecord;
  triggerTime: Date;
};

const DAY_MS = 24 * 60 * 60 * 1000;

// A single missed occurrence older than this is treated as "water under the
// bridge": we don't materialise a goal for it (the caller still advances
// last_triggered_at past it). Keeps a client that has been closed for a while
// from resurrecting a stale reminder days later. Covers a weekend gap.
const TRIGGER_GRACE_MS = 3 * DAY_MS;

/** Local midnight of the given date (crons are authored in local time). */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/**
 * Which recurring goals are due to fire, and when.
 *
 * Returns **at most one** trigger per template — the most recent occurrence at
 * or before `now`. We never emit a goal per missed occurrence: a monthly bill
 * seeded months ago must not spawn one goal for every month since creation
 * (that flooded the board with duplicates on the first client to run this).
 *
 * A template that has NEVER triggered (`last_triggered_at === null`) is
 * baselined to the **start of today**, not its `created_at`. So a freshly
 * seeded reminder is "armed for today" only — it can fire for an occurrence
 * that falls today, but never back-fills history.
 */
export function findPendingTriggers(
  recurringGoals: RecurringGoalRecord[],
  now: Date = new Date(),
): PendingTrigger[] {
  const pending: PendingTrigger[] = [];

  for (const rg of recurringGoals) {
    // -1ms so an occurrence at exactly local 00:00 today still counts as due
    // (cron-parser's currentDate is exclusive for next()).
    const windowStart = rg.last_triggered_at
      ? new Date(rg.last_triggered_at)
      : new Date(startOfDay(now).getTime() - 1);

    try {
      const interval = CronExpressionParser.parse(rg.cron_expression, {
        currentDate: windowStart,
        endDate: now,
      });

      // Collapse every missed occurrence in the window down to the single most
      // recent one.
      let latest: Date | null = null;
      while (interval.hasNext()) {
        const next = interval.next().toDate();
        if (next > now) break;
        latest = next;
      }
      if (!latest) continue;

      // Don't resurrect a stale single occurrence (long-closed client).
      if (now.getTime() - latest.getTime() > TRIGGER_GRACE_MS) continue;

      pending.push({ recurringGoal: rg, triggerTime: latest });
    } catch {
      console.warn(`Invalid cron expression for recurring goal ${rg.id}: ${rg.cron_expression}`);
    }
  }

  return pending;
}

export function isValidCron(expression: string): boolean {
  try {
    CronExpressionParser.parse(expression);
    return true;
  } catch {
    return false;
  }
}
