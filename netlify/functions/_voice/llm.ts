/**
 * LLM classification: transcript → {intent, payload, confidence, raw_user_phrase}.
 *
 * Provider order (free → paid):
 *   1. Groq Llama-3.3-70b — generous free tier, OpenAI-compatible JSON mode.
 *   2. Anthropic Claude Haiku — paid, used only if ANTHROPIC_API_KEY is set.
 *   3. OpenAI gpt-4o-mini — paid, ultimate fallback.
 *
 * Why Groq primary: the user's account is on Groq's free tier (no credit
 * card required), and Llama-3.3-70b classifies short Russian phrases against
 * a fixed JSON schema with quality close to Claude Haiku. We fall through
 * to paid providers only when their API keys are explicitly configured AND
 * Groq itself errored — keeps the pipeline working even if Groq is down.
 *
 * The system prompt is generated from INTENT_REGISTRY so adding intents
 * later doesn't require touching this file.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { INTENT_REGISTRY } from './intents';
import type { LlmClassification } from './types';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-3-5-haiku-latest';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = 'gpt-4o-mini';

export type LlmContext = {
  goals: Array<{ id: string; title: string }>;
  recent_tasks: Array<{ id: string; title: string; category_names: string[] }>;
  categories: Array<{ id: string; name: string }>;
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

  const [goalsRes, tasksRes, categoriesRes] = await Promise.all([
    supabase
      .from('goals')
      .select('id, title')
      .eq('user_id', userId)
      .eq('is_done', false)
      .is('archived_at', null)
      .order('sort_order', { ascending: true })
      .limit(50),
    supabase
      .from('micro_tasks')
      .select('id, title, created_at, task_category_links(category_id, task_categories(name))')
      .eq('user_id', userId)
      .gte('created_at', fourteenDaysAgo)
      .order('created_at', { ascending: false })
      .limit(30),
    supabase
      .from('task_categories')
      .select('id, name')
      .eq('user_id', userId)
      .order('name', { ascending: true }),
  ]);

  if (goalsRes.error) throw new Error(`goals: ${goalsRes.error.message}`);
  if (tasksRes.error) throw new Error(`tasks: ${tasksRes.error.message}`);
  if (categoriesRes.error) throw new Error(`categories: ${categoriesRes.error.message}`);

  const recent_tasks = (tasksRes.data ?? []).map((row) => {
    const links = (row as { task_category_links?: Array<{ task_categories?: { name?: string } }> })
      .task_category_links ?? [];
    const category_names = links
      .map((l) => l.task_categories?.name)
      .filter((n): n is string => typeof n === 'string');
    return { id: row.id as string, title: row.title as string, category_names };
  });

  return {
    goals: (goalsRes.data ?? []) as Array<{ id: string; title: string }>,
    recent_tasks,
    categories: (categoriesRes.data ?? []) as Array<{ id: string; name: string }>,
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

  return `Ты помощник, который превращает голосовую заметку пользователя в команду для дашборда.

ДОСТУПНЫЕ INTENT'Ы:
${intentSection}${rulesHint}

КОНТЕКСТ ПОЛЬЗОВАТЕЛЯ:
ОТКРЫТЫЕ ЦЕЛИ: ${goalsJson}
НЕДАВНИЕ МИКРОЗАДАЧИ (последние 14 дней): ${tasksJson}
ДОСТУПНЫЕ КАТЕГОРИИ: ${categoriesJson}

ОТВЕТЬ СТРОГО JSON В ФОРМАТЕ:
{
  "intent": "<один из доступных intent'ов>",
  "payload": <согласно схеме выбранного intent'а>,
  "confidence": "high" | "medium" | "low",
  "raw_user_phrase": "<точная фраза пользователя>"
}

Правила:
1. similar_task_id ставь ТОЛЬКО при очень высоком сходстве (та же самая активность). Иначе null.
2. Если similar_task_id найден — category_ids = его категории. Не выдумывай новые.
3. Никогда не возвращай category_ids с UUID, которых НЕТ в ДОСТУПНЫЕ КАТЕГОРИИ.
4. goal_id ставь, только если связь явная.
5. Никогда не выдумывай UUID. Все UUID — только из контекста выше или null.
6. Никакого текста кроме JSON.`;
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

export type LlmSuccess = { ok: true; classification: LlmClassification };
export type LlmFailure = { ok: false; reason: 'all_providers_failed'; detail: string };
export type LlmResult = LlmSuccess | LlmFailure;

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
  if (!parsed || typeof parsed !== 'object') {
    return {
      ok: false,
      reason: 'all_providers_failed',
      detail: `parsed result is not an object: ${raw.slice(0, 100)}`,
    };
  }
  const obj = parsed as Record<string, unknown>;
  const intent = typeof obj.intent === 'string' ? obj.intent : '';
  const payload =
    obj.payload && typeof obj.payload === 'object' ? (obj.payload as Record<string, unknown>) : {};
  const confidenceRaw = obj.confidence;
  const confidence: 'high' | 'medium' | 'low' =
    confidenceRaw === 'high' || confidenceRaw === 'medium' || confidenceRaw === 'low'
      ? confidenceRaw
      : 'medium';
  const raw_user_phrase =
    typeof obj.raw_user_phrase === 'string' ? obj.raw_user_phrase : args.transcript;

  return {
    ok: true,
    classification: { intent, payload, confidence, raw_user_phrase },
  };
}
