/**
 * One-shot seeder for the user's "calendar reminders" recurring goals:
 * birthdays, holiday greetings, gift-buying lead-times, monthly bills.
 *
 * Run:
 *   tsx scripts/seed-recurring-goals.ts <user-email>
 *
 * Idempotent: rows are matched by title within the user's goals widget. If a
 * recurring goal with the exact title already exists for that user, it gets
 * updated to the latest cron expression instead of being duplicated.
 *
 * Cron format: "minute hour day-of-month month day-of-week" (Vixie cron via
 * cron-parser). Times are 00:00 in the runtime's local timezone — i.e. when
 * the user opens the dashboard on the trigger day, the cron parser sees
 * `last_triggered_at < midnight today` and fires the goal.
 *
 * "3 weeks before X" = X minus 21 days (computed below as a static date so we
 * don't need a custom scheduler — cron just fires on the resulting date).
 *
 * "Last Sunday of November" = day-of-month 24-30 + day-of-week 0. Vixie cron
 * AND-s those constraints, so it fires only on whichever of the 24th-30th
 * happens to be a Sunday in any given year (always exactly one).
 */
import 'dotenv/config';

import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const adminClient = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type SeedGoal = {
  title: string;
  cron: string;
};

const BIRTHDAYS: Array<{ name: string; day: number; month: number }> = [
  { name: 'мама', day: 4, month: 9 },
  { name: 'папа', day: 30, month: 10 },
  { name: 'Денис', day: 18, month: 10 },
  { name: 'Викусик', day: 24, month: 11 },
  { name: 'Вика', day: 25, month: 7 },
  { name: 'Алёна', day: 6, month: 7 },
  { name: 'Никита', day: 21, month: 4 },
  { name: 'бабушка Зол', day: 4, month: 9 },
  { name: 'дедушка Витя', day: 28, month: 3 },
  { name: 'бабушка Замятина', day: 20, month: 6 },
  { name: 'дедушка Коля', day: 19, month: 3 },
  { name: 'Инга', day: 18, month: 11 },
  { name: 'Игорь', day: 3, month: 5 },
  { name: 'Нарек', day: 12, month: 9 },
  { name: 'Артём', day: 28, month: 9 },
  { name: 'Даша', day: 9, month: 8 },
  { name: 'Кирилл', day: 7, month: 10 },
  { name: 'Элиза', day: 19, month: 2 },
  { name: 'Ксюша+Серёжа', day: 28, month: 3 },
  { name: 'Гриша Ч', day: 15, month: 11 },
  { name: 'Илья Садов', day: 18, month: 11 },
  { name: 'Мороз', day: 11, month: 12 },
  { name: 'Елик', day: 2, month: 4 },
  { name: 'Жарин', day: 23, month: 1 },
  { name: 'ГР', day: 28, month: 8 },
  { name: 'Шама', day: 26, month: 4 },
  { name: 'Арман', day: 11, month: 2 },
  { name: 'Махмуд', day: 15, month: 7 },
  { name: 'Иван', day: 26, month: 4 },
  { name: 'Аня', day: 7, month: 10 },
];

/** People who get a birthday gift bought 3 weeks ahead. */
const GIFT_BIRTHDAY_NAMES = new Set([
  'Викусик',
  'Денис',
  'мама',
  'папа',
  'Нарек',
  'Артём',
]);

/** "31 декабря" → ["Мороз", "Артём", ...]. Stored as `${day} ${month}` key. */
const HOLIDAY_GREETINGS: Array<{ day: number; month: number; label: string; people: string[] }> = [
  { day: 31, month: 12, label: 'Новый год', people: ['Мороз', 'Артём', 'семья', 'Елик', 'Чикиплита', 'бро 18'] },
  { day: 7, month: 1, label: 'Рождество', people: ['Замятины', 'Золотухины'] },
  { day: 14, month: 2, label: '14 февраля', people: ['Викусик'] },
  { day: 23, month: 2, label: '23 февраля', people: ['папа', 'дедушка Коля', 'дедушка Витя'] },
  { day: 8, month: 3, label: '8 марта', people: ['мама', 'Инга', 'бабушка Замятина', 'бабушка Золотухина', 'Викусик'] },
  { day: 1, month: 4, label: '1 апреля', people: ['Викусик'] },
  { day: 8, month: 5, label: '8 мая', people: ['Викусик'] },
];

// `0L` is cron-parser's "last Sunday" syntax (verified at runtime — see
// scripts/seed-recurring-goals.ts comments). Vixie's day-of-month + DOW would
// OR, which would fire all 7 days of the last week.
const MOTHERS_DAY = { cron: '0 0 * 11 0L', title: 'Поздравить маму с Днём матери' };

/** Holidays that need a gift bought 3 weeks ahead. */
const GIFT_HOLIDAYS: Array<{ day: number; month: number; label: string }> = [
  { day: 1, month: 1, label: 'Новый год' },
  { day: 14, month: 2, label: '14 февраля' },
  { day: 8, month: 3, label: '8 марта' },
  { day: 8, month: 5, label: '8 мая' },
];

/** Recurring monthly/yearly bills/admin tasks. */
const PAYMENT_GOALS: SeedGoal[] = [
  { title: 'Отправить счётчики электричества', cron: '0 0 25 * *' },
  { title: 'Отправить счётчики воды', cron: '0 0 30 * *' },
  { title: 'Заплатить за хату', cron: '0 0 1 * *' },
  { title: 'Заплатить за интернет', cron: '0 0 16 * *' },
  { title: 'Записаться на чек-ап', cron: '0 0 6 2 *' },
  { title: 'Оформить отсрочку (январь)', cron: '0 0 22 1 *' },
  { title: 'Оформить отсрочку (июль)', cron: '0 0 25 7 *' },
  { title: 'Активировать промокод Яндекс+', cron: '0 0 10 12 *' },
  { title: 'Подписка ChatGPT истечёт через 2 дня', cron: '0 0 22 12 *' },
];

/** Subtract `days` from {day, month} in a non-leap-year context (uses 2025). */
function subtractDays(month: number, day: number, days: number): { day: number; month: number } {
  // Use a fixed reference year that's NOT a leap year so 28/2 stays sane.
  const ref = new Date(Date.UTC(2025, month - 1, day));
  ref.setUTCDate(ref.getUTCDate() - days);
  return { day: ref.getUTCDate(), month: ref.getUTCMonth() + 1 };
}

function buildGoals(): SeedGoal[] {
  const goals: SeedGoal[] = [];

  // 1. Birthdays
  for (const b of BIRTHDAYS) {
    goals.push({
      title: `Поздравить с ДР: ${b.name}`,
      cron: `0 0 ${b.day} ${b.month} *`,
    });
    if (GIFT_BIRTHDAY_NAMES.has(b.name)) {
      const { day, month } = subtractDays(b.month, b.day, 21);
      goals.push({
        title: `Купить подарок на ДР: ${b.name}`,
        cron: `0 0 ${day} ${month} *`,
      });
    }
  }

  // 2. Holiday greetings
  for (const h of HOLIDAY_GREETINGS) {
    for (const person of h.people) {
      goals.push({
        title: `Поздравить с ${h.label}: ${person}`,
        cron: `0 0 ${h.day} ${h.month} *`,
      });
    }
  }
  goals.push(MOTHERS_DAY);

  // 3. Holiday gifts
  for (const h of GIFT_HOLIDAYS) {
    const { day, month } = subtractDays(h.month, h.day, 21);
    goals.push({
      title: `Купить подарок на ${h.label}`,
      cron: `0 0 ${day} ${month} *`,
    });
  }

  // 4. Payments / admin
  goals.push(...PAYMENT_GOALS);

  return goals;
}

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: tsx scripts/seed-recurring-goals.ts <email>');
    process.exit(1);
  }

  // Find user.
  const { data: usersData, error: usersError } = await adminClient.auth.admin.listUsers({
    perPage: 200,
  });
  if (usersError) throw usersError;
  const user = usersData.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) {
    console.error(`No user found with email ${email}`);
    process.exit(1);
  }
  console.log(`Found user ${user.email} (${user.id})`);

  // Find user's goals widget.
  const { data: widget, error: widgetError } = await adminClient
    .from('widgets')
    .select('id, dashboard_id')
    .eq('type', 'goals')
    .filter('config->>title', 'not.is', null)
    .order('created_at', { ascending: true })
    .limit(50);
  if (widgetError) throw widgetError;

  // The widgets table doesn't carry user_id — go via dashboards.
  const { data: dashboards, error: dashError } = await adminClient
    .from('dashboards')
    .select('id, user_id')
    .eq('user_id', user.id);
  if (dashError) throw dashError;
  const dashIds = new Set(dashboards?.map((d) => d.id) ?? []);
  const goalsWidget = widget?.find((w) => dashIds.has(w.dashboard_id));
  if (!goalsWidget) {
    console.error(`User ${user.email} has no goals-type widget`);
    process.exit(1);
  }
  console.log(`Goals widget: ${goalsWidget.id}`);

  // Existing recurring goals for dedupe.
  const { data: existing, error: existingError } = await adminClient
    .from('recurring_goals')
    .select('id, title, cron_expression')
    .eq('widget_id', goalsWidget.id);
  if (existingError) throw existingError;
  const byTitle = new Map(existing?.map((r) => [r.title, r]) ?? []);

  const goals = buildGoals();
  console.log(`\nPlanned ${goals.length} recurring goals.\n`);

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  for (const g of goals) {
    const prior = byTitle.get(g.title);
    if (prior) {
      if (prior.cron_expression === g.cron) {
        unchanged += 1;
        continue;
      }
      const { error } = await adminClient
        .from('recurring_goals')
        .update({ cron_expression: g.cron })
        .eq('id', prior.id);
      if (error) throw error;
      updated += 1;
      console.log(`UPDATE  ${g.title.padEnd(50)} ${prior.cron_expression}  →  ${g.cron}`);
    } else {
      const { error } = await adminClient.from('recurring_goals').insert({
        widget_id: goalsWidget.id,
        user_id: user.id,
        title: g.title,
        cron_expression: g.cron,
        value: 0,
        expected_hours: 0,
      });
      if (error) throw error;
      inserted += 1;
      console.log(`INSERT  ${g.title.padEnd(50)} ${g.cron}`);
    }
  }

  console.log(`\n${inserted} inserted, ${updated} updated, ${unchanged} unchanged.`);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
