import { CronExpressionParser } from 'cron-parser';
import type { RecurringGoalRecord } from './types';

export type PendingTrigger = {
  recurringGoal: RecurringGoalRecord;
  triggerTime: Date;
};

export function findPendingTriggers(
  recurringGoals: RecurringGoalRecord[],
  now: Date = new Date(),
): PendingTrigger[] {
  const pending: PendingTrigger[] = [];

  for (const rg of recurringGoals) {
    try {
      const interval = CronExpressionParser.parse(rg.cron_expression, {
        currentDate: rg.last_triggered_at ? new Date(rg.last_triggered_at) : new Date(rg.created_at),
        endDate: now,
      });

      while (interval.hasNext()) {
        const next = interval.next();
        if (next.toDate() > now) break;
        pending.push({ recurringGoal: rg, triggerTime: next.toDate() });
      }
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
