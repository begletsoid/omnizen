/**
 * LLM action-plan classifier (Phase 2).
 *
 * Phase 1 returned a single intent. Phase 2 returns an array of actions to
 * support undo+chain combos like "Отмена, начни X" → [undo_last, start_microtask].
 *
 * Provider order (free → paid):
 *   1. Groq Llama-3.3-70b — generous free tier, OpenAI-compatible JSON mode.
 *   2. Anthropic Claude Haiku — paid, used only if ANTHROPIC_API_KEY is set.
 *   3. OpenAI gpt-4o-mini — paid, ultimate fallback.
 *
 * The system prompt is generated from INTENT_REGISTRY so adding intents
 * later doesn't require touching this file.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { INTENT_REGISTRY } from './intents';
import { MAX_ACTIONS_PER_COMMAND, type LlmAction, type LlmActionPlan } from './types';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-3-5-haiku-latest';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = 'gpt-4o-mini';

export type LlmContext = {
  goals: Array<{ id: string; title: string }>;
  recent_tasks: Array<{ id: string; title: string; category_names: string[] }>;
  categories: Array<{
    id: string;
    name: string;
    /** User-written hint about what falls into this category. Null when blank. */
    description: string | null;
    /** True if the category mirrors a tag (auto-generated). User-created ones
     *  carry stronger semantic intent and are preferred at equal match. */
    is_auto: boolean;
    /** Names of tags linked to this category — keyword evidence the LLM uses. */
    tag_names: string[];
  }>;
  /** UUIDs from task_category_buffers.category_ids — user's typical default set. */
  recent_buffer: string[];
};

/**
 * Pull the LLM context for the current user. Bounded so the prompt stays
 * compact: open goals only, micro_tasks last 14 days top 30 by recency,
 * all categories (usually <30).
 */
export async function loadLlmContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<LlmContext> {
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const [goalsRes, tasksRes, categoriesRes, bufferRes] = await Promise.all([
    supabase
      .from('goals')
      .select('id, title')
      .eq('user_id', userId)
      .eq('is_done', false)
      .is('archived_at', null)
      .order('sort_order', { ascending: true })
      .limit(50),
    // Phase 2: only ACTIVE micro-tasks (not done, not archived) qualify
    // for resume — we mustn't restart a finished one. Limit raised to 30
    // by recency; the LLM has more options to match against.
    supabase
      .from('micro_tasks')
      .select('id, title, created_at, task_category_links(category_id, task_categories(name))')
      .eq('user_id', userId)
      .eq('is_done', false)
      .is('archived_at', null)
      .gte('created_at', fourteenDaysAgo)
      .order('created_at', { ascending: false })
      .limit(30),
    // Phase 3: include description + is_auto + linked tags. The JOIN through
    // category_tags → task_tags pulls every tag's name so the LLM sees the
    // category's keyword footprint (e.g. {name: "Работа", tag_names: ["pr",
    // "review", "code"]}). Single round-trip via PostgREST embed.
    // Phase 3.1: filter out archived categories and archived tags — the
    // user has explicitly hidden them, and feeding them to the LLM would
    // make it auto-attach archived categories to new voice-created tasks.
    supabase
      .from('task_categories')
      .select(
        'id, name, description, is_auto, category_tags(task_tags(name, archived_at))',
      )
      .eq('user_id', userId)
      .is('archived_at', null)
      .order('name', { ascending: true }),
    supabase
      .from('task_category_buffers')
      .select('category_ids')
      .eq('user_id', userId)
      .maybeSingle(),
  ]);

  if (goalsRes.error) throw new Error(`goals: ${goalsRes.error.message}`);
  if (tasksRes.error) throw new Error(`tasks: ${tasksRes.error.message}`);
  if (categoriesRes.error) throw new Error(`categories: ${categoriesRes.error.message}`);
  if (bufferRes.error) throw new Error(`buffer: ${bufferRes.error.message}`);

  const recent_tasks = (tasksRes.data ?? []).map((row) => {
    const links = (row as { task_category_links?: Array<{ task_categories?: { name?: string } }> })
      .task_category_links ?? [];
    const category_names = links
      .map((l) => l.task_categories?.name)
      .filter((n): n is string => typeof n === 'string');
    return { id: row.id as string, title: row.title as string, category_names };
  });

  const categories = (categoriesRes.data ?? []).map((row) => {
    const r = row as {
      id: string;
      name: string;
      description: string | null;
      is_auto: boolean;
      category_tags?: Array<{ task_tags?: { name?: string; archived_at?: string | null } }>;
    };
    const tag_names = (r.category_tags ?? [])
      // Skip archived tags — they're hidden in the UI and shouldn't influence
      // the LLM's keyword evidence for the category.
      .filter((ct) => ct.task_tags && !ct.task_tags.archived_at)
      .map((ct) => ct.task_tags?.name)
      .filter((n): n is string => typeof n === 'string');
    return {
      id: r.id,
      name: r.name,
      description: r.description ?? null,
      is_auto: Boolean(r.is_auto),
      tag_names,
    };
  });

  const recent_buffer = Array.isArray(bufferRes.data?.category_ids)
    ? (bufferRes.data!.category_ids as string[])
    : [];

  return {
    goals: (goalsRes.data ?? []) as Array<{ id: string; title: string }>,
    recent_tasks,
    categories,
    recent_buffer,
  };
}

/** Build the user-facing system prompt from the intent registry. */
export function buildSystemPrompt(
  context: LlmContext,
  userRules: Record<string, string>,
): string {
  const intentSection = Object.entries(INTENT_REGISTRY)
    .map(([key, spec]) => `- intent="${key}": ${spec.description}\n  payload schema:\n${spec.payloadShape}`)
    .join('\n\n');

  const rulesHint = Object.keys(userRules).length > 0
    ? `\n\nПРАВИЛА ПОЛЬЗОВАТЕЛЯ (если фраза содержит ключевое слово, intent должен быть указан):\n${Object.entries(userRules)
        .map(([keyword, intent]) => `- если "${keyword}" → intent="${intent}"`)
        .join('\n')}`
    : '';

  const goalsJson = JSON.stringify(context.goals);
  const tasksJson = JSON.stringify(context.recent_tasks);
  const categoriesJson = JSON.stringify(context.categories);
  const recentBufferJson = JSON.stringify(context.recent_buffer);

  return `Ты помощник, который превращает голосовую заметку пользователя в план команд (actions) для дашборда.

ДОСТУПНЫЕ INTENT'Ы:
${intentSection}${rulesHint}

КОНТЕКСТ ПОЛЬЗОВАТЕЛЯ:
ОТКРЫТЫЕ_ЦЕЛИ: ${goalsJson}
НЕДАВНИЕ_АКТИВНЫЕ_МИКРОЗАДАЧИ (не done, не archived, последние 14 дней): ${tasksJson}
ДОСТУПНЫЕ_КАТЕГОРИИ: ${categoriesJson}
  // Каждая запись содержит:
  //   id           — UUID для использования в category_ids.
  //   name         — отображаемое имя.
  //   description  — что попадает в категорию (null если не заполнено).
  //   tag_names    — связанные ключевые слова из тегов.
  //   is_auto      — true означает category-автодвойник тега, чуть менее семантичный.
ОБЫЧНЫЙ_НАБОР_КАТЕГОРИЙ_ПОЛЬЗОВАТЕЛЯ: ${recentBufferJson}
  // UUID-ы категорий, которые юзер выбирает чаще всего. Используй как дефолт когда фраза неоднозначна.

ОТВЕТЬ СТРОГО JSON В ФОРМАТЕ:
{
  "actions": [
    { "intent": "<один из доступных>", "payload": <согласно схеме intent'а> }
    // 1..${MAX_ACTIONS_PER_COMMAND} элементов; обычно 1
  ],
  "confidence": "high" | "medium" | "low",
  "raw_user_phrase": "<точная фраза пользователя>"
}

Правила:
1. **Однокомандный голос → массив длины 1.** Если фраза — одна команда, всегда возвращай ОДИН элемент в actions.
2. **Цепочки (undo + следующая команда):** если фраза начинается с "отмена" / "отмени" и продолжается ("отмена, начни X") — возвращай ДВА элемента: сначала undo_last, потом следующая команда.
3. **Дефолт = start_microtask:** если фраза не подпадает ни под одно правило и звучит как описание активности ("обед", "код-ревью", "пишу статью") — это start_microtask.
4. **Find-or-create для start_microtask:**
   - Сначала проверь НЕДАВНИЕ_АКТИВНЫЕ_МИКРОЗАДАЧИ. Если есть задача с очень похожим по смыслу названием — ставь mode="resume", resume_task_id = её UUID, остальные поля null/[].
   - Иначе mode="create", new_task_title = нормализованное название, и если фраза явно про какую-то ОТКРЫТУЮ_ЦЕЛЬ — выставь её UUID в goal_id.
5. **Категоризация (mode="create"):**
   a. Если в payload стоит goal_id — категории НЕ выбирай сам, оставляй category_ids=[]. Сервер автоматически унаследует категории цели.
   b. Если goal_id=null — старайся выбрать РОВНО ОДНУ категорию (category_ids длины 1). Несколько категорий допустимо только если задача честно лежит на стыке двух тем и одну выбрать невозможно. Пустой массив [] — нормальный исход, когда явного совпадения нет: лучше [], чем угадывать.
   c. Как выбирать:
      - Сначала смотри на description: если фраза про что-то описанное в категории (например description «приёмы пищи, обед, ужин» → подходит для «Обед») — это сильный сигнал.
      - Затем на tag_names: совпадение слов из фразы с тегами категории — тоже сильный сигнал.
      - При равном совпадении предпочитай is_auto=false (созданные пользователем сильнее, чем category-автодвойники тегов).
   d. **Предпочитай более узкие категории более широким.** Если фраза одновременно подходит под общую категорию (например «Работа») и под более специфичную внутри неё («Код-ревью», «Митинги») — выбирай специфичную. Узость определяется по описанию и тегам: чем уже и конкретнее description / чем меньше «общих» тегов — тем категория уже. Широкая категория уместна только когда специфичной нет в списке.
   e. Fallback: если не нашлось явных совпадений и фраза неоднозначна — используй ОБЫЧНЫЙ_НАБОР_КАТЕГОРИЙ_ПОЛЬЗОВАТЕЛЯ как дефолт (тоже одной категорией, если возможно).
   f. Если у пользователя нет ни описаний, ни тегов, ни buffer — лучше вернуть category_ids=[] чем выдумывать.
6. **Парсинг add_goal:** "добавь цель X цена N время N часов" — title=X, value=N (если "цена"), expected_hours=N (если "время"). value/expected_hours = null если не упомянуты.
7. **Никаких UUID, которых нет в КОНТЕКСТЕ.** Все UUID — строго из ОТКРЫТЫЕ_ЦЕЛИ / НЕДАВНИЕ_АКТИВНЫЕ_МИКРОЗАДАЧИ / ДОСТУПНЫЕ_КАТЕГОРИИ или null.
8. **Никакого текста кроме JSON.** Никаких \`\`\` обёрток.`;
}

function extractJson(text: string): unknown {
  // LLMs sometimes wrap JSON in ``` fences. Strip them.
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall back to greedy match for the first {...} block.
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('LLM did not return parseable JSON');
  }
}

async function callAnthropic(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = json.content?.find((c) => c.type === 'text')?.text;
  if (!text) throw new Error('Anthropic response missing text');
  return text;
}

async function callOpenAi(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = json.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenAI response missing content');
  return text;
}

/**
 * Groq uses an OpenAI-compatible chat-completions endpoint, so the request
 * shape matches OpenAI exactly aside from the URL + model. JSON mode is
 * supported on llama-3.3-70b-versatile per Groq's structured-outputs docs.
 */
async function callGroq(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      response_format: { type: 'json_object' },
      temperature: 0.1,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Groq HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = json.choices?.[0]?.message?.content;
  if (!text) throw new Error('Groq response missing content');
  return text;
}

export type LlmSuccess = { ok: true; plan: LlmActionPlan };
export type LlmFailure = { ok: false; reason: 'all_providers_failed'; detail: string };
export type LlmResult = LlmSuccess | LlmFailure;

/**
 * Coerce LLM output into an LlmActionPlan. Backward-compat: if the model
 * returned the Phase 1 single-intent shape `{intent, payload, ...}`, wrap
 * it in `actions: [{intent, payload}]`. Reject anything that's neither.
 */
export function parseActionPlan(raw: unknown, fallbackTranscript: string): LlmActionPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const confidenceRaw = obj.confidence;
  const confidence: 'high' | 'medium' | 'low' =
    confidenceRaw === 'high' || confidenceRaw === 'medium' || confidenceRaw === 'low'
      ? confidenceRaw
      : 'medium';
  const raw_user_phrase =
    typeof obj.raw_user_phrase === 'string' ? obj.raw_user_phrase : fallbackTranscript;

  // Phase 2 shape: { actions: [...] }.
  if (Array.isArray(obj.actions)) {
    const actions: LlmAction[] = [];
    // Filter first, slice second — invalid entries shouldn't consume the
    // 3-action budget. (e.g. ["good", null, "good"] should yield 2 actions,
    // not 1 because slice dropped the second "good".)
    for (const entry of obj.actions) {
      if (actions.length >= MAX_ACTIONS_PER_COMMAND) break;
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      const intent = typeof e.intent === 'string' ? e.intent : '';
      const payload =
        e.payload && typeof e.payload === 'object' ? (e.payload as Record<string, unknown>) : {};
      if (intent) actions.push({ intent, payload });
    }
    if (actions.length === 0) return null;
    return { actions, confidence, raw_user_phrase };
  }

  // Backward-compat: Phase 1 single-intent shape.
  if (typeof obj.intent === 'string') {
    const payload =
      obj.payload && typeof obj.payload === 'object' ? (obj.payload as Record<string, unknown>) : {};
    return {
      actions: [{ intent: obj.intent, payload }],
      confidence,
      raw_user_phrase,
    };
  }

  return null;
}

export async function classifyVoice(
  supabase: SupabaseClient,
  args: {
    userId: string;
    transcript: string;
    voiceIntentRules: Record<string, string>;
  },
): Promise<LlmResult> {
  const context = await loadLlmContext(supabase, args.userId);
  const systemPrompt = buildSystemPrompt(context, args.voiceIntentRules);
  const userMessage = `Фраза пользователя: "${args.transcript}"`;

  const errors: string[] = [];
  let raw: string | null = null;

  // 1. Groq Llama-3.3-70b — primary, free tier.
  if (process.env.GROQ_API_KEY) {
    try {
      raw = await callGroq(process.env.GROQ_API_KEY, systemPrompt, userMessage);
    } catch (err) {
      errors.push(`groq: ${(err as Error).message}`);
    }
  } else {
    errors.push('groq: GROQ_API_KEY missing');
  }

  // 2. Anthropic Claude Haiku — paid fallback. Skipped silently when key absent.
  if (!raw && process.env.ANTHROPIC_API_KEY) {
    try {
      raw = await callAnthropic(process.env.ANTHROPIC_API_KEY, systemPrompt, userMessage);
    } catch (err) {
      errors.push(`anthropic: ${(err as Error).message}`);
    }
  }

  // 3. OpenAI gpt-4o-mini — paid fallback. Skipped silently when key absent.
  if (!raw && process.env.OPENAI_API_KEY) {
    try {
      raw = await callOpenAi(process.env.OPENAI_API_KEY, systemPrompt, userMessage);
    } catch (err) {
      errors.push(`openai: ${(err as Error).message}`);
    }
  }

  if (!raw) {
    return { ok: false, reason: 'all_providers_failed', detail: errors.join(' | ') };
  }

  const parsed = extractJson(raw);
  const plan = parseActionPlan(parsed, args.transcript);
  if (!plan) {
    return {
      ok: false,
      reason: 'all_providers_failed',
      detail: `LLM returned no actions: ${raw.slice(0, 200)}`,
    };
  }
  return { ok: true, plan };
}

// ============================================================================
// classifyCategoriesForTitle — lightweight variant used when the user creates
// a micro-task via the UI input (not via voice). We just need to pick 0..1
// category UUIDs from the user's set based on the task title — no intent
// classification, no resume/create branching, no goal linking. The compact
// prompt keeps latency low (~500-1000 ms typical) since the user is staring
// at the dashboard waiting for the task to appear.
// ============================================================================

export type ClassifyCategoriesSuccess = { ok: true; category_ids: string[] };
export type ClassifyCategoriesFailure = { ok: false; reason: string };
export type ClassifyCategoriesResult =
  | ClassifyCategoriesSuccess
  | ClassifyCategoriesFailure;

function buildCategoryClassifyPrompt(context: LlmContext): string {
  const categoriesJson = JSON.stringify(context.categories);
  const recentBufferJson = JSON.stringify(context.recent_buffer);
  const recentTasksJson = JSON.stringify(
    context.recent_tasks.map((t) => ({ title: t.title, category_names: t.category_names })),
  );
  return `Ты помощник, который подбирает категории для микрозадачи по её названию.

ДОСТУПНЫЕ_КАТЕГОРИИ: ${categoriesJson}
  // Каждая: { id, name, description, tag_names, is_auto }.

ПОХОЖИЕ_СВЕЖИЕ_ЗАДАЧИ: ${recentTasksJson}
  // Названия + категории недавних задач — для опоры на привычный выбор пользователя.

ОБЫЧНЫЙ_НАБОР_КАТЕГОРИЙ_ПОЛЬЗОВАТЕЛЯ: ${recentBufferJson}
  // UUIDs категорий, которые пользователь выбирает чаще всего.

ОТВЕТЬ СТРОГО JSON:
{ "category_ids": [<0..1 UUID из ДОСТУПНЫЕ_КАТЕГОРИИ>] }

Правила:
1. Старайся выбрать РОВНО ОДНУ категорию. Несколько — только если задача честно на стыке двух тем.
2. Пустой массив [] — нормально, если нет уверенного совпадения. Лучше [], чем угадывать.
3. Описание (description) категории — главный сигнал: если в нём упомянуто что описано в названии задачи, это совпадение.
4. Теги (tag_names) — тоже сильный сигнал: совпадение слова из названия с тегом категории.
5. При двойном совпадении предпочитай более узкую категорию более широкой.
6. При полной неоднозначности можно использовать ОБЫЧНЫЙ_НАБОР как дефолт.
7. Никаких UUID, которых нет в ДОСТУПНЫЕ_КАТЕГОРИИ. Никакого текста кроме JSON.`;
}

function parseCategoryIdsResponse(raw: unknown): string[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const ids = (raw as { category_ids?: unknown }).category_ids;
  if (!Array.isArray(ids)) return null;
  return ids.filter((x): x is string => typeof x === 'string');
}

export async function classifyCategoriesForTitle(
  supabase: SupabaseClient,
  args: { userId: string; title: string },
): Promise<ClassifyCategoriesResult> {
  const context = await loadLlmContext(supabase, args.userId);
  if (context.categories.length === 0) {
    // No categories means no work to do — return empty quickly without
    // burning an LLM call.
    return { ok: true, category_ids: [] };
  }

  const systemPrompt = buildCategoryClassifyPrompt(context);
  const userMessage = `Название задачи: "${args.title}"`;

  const errors: string[] = [];
  let raw: string | null = null;

  if (process.env.GROQ_API_KEY) {
    try {
      raw = await callGroq(process.env.GROQ_API_KEY, systemPrompt, userMessage);
    } catch (err) {
      errors.push(`groq: ${(err as Error).message}`);
    }
  } else {
    errors.push('groq: GROQ_API_KEY missing');
  }
  if (!raw && process.env.ANTHROPIC_API_KEY) {
    try {
      raw = await callAnthropic(process.env.ANTHROPIC_API_KEY, systemPrompt, userMessage);
    } catch (err) {
      errors.push(`anthropic: ${(err as Error).message}`);
    }
  }
  if (!raw && process.env.OPENAI_API_KEY) {
    try {
      raw = await callOpenAi(process.env.OPENAI_API_KEY, systemPrompt, userMessage);
    } catch (err) {
      errors.push(`openai: ${(err as Error).message}`);
    }
  }

  if (!raw) {
    return { ok: false, reason: errors.join(' | ') };
  }
  const parsed = extractJson(raw);
  const ids = parseCategoryIdsResponse(parsed);
  if (ids === null) {
    return { ok: false, reason: `unparseable LLM response: ${raw.slice(0, 200)}` };
  }
  // Validate IDs against the user's known categories — strip anything the
  // model invented. The webhook still re-validates ownership server-side,
  // but doing it here avoids a round-trip on bogus results.
  const validIds = new Set(context.categories.map((c) => c.id));
  return { ok: true, category_ids: ids.filter((id) => validIds.has(id)).slice(0, 1) };
}
