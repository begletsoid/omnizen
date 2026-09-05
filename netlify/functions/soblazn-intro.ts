import { createClient } from "@supabase/supabase-js";

/**
 * soblazn → «начни с ней» с телефона.
 *
 * Быстрая команда на iPhone шлёт сюда POST с одной строкой:
 *     { "token": "<токен>", "line": "anna_k Аня 24 pure 80" }
 * (или text/plain со строкой и заголовком Authorization: Bearer <токен>).
 * Строка строго: логин имя возраст сайт оценка, пропуск — «-».
 *
 * Функция кладёт строку в таблицу soblazn_intros. Бот soblazn на компе Макса
 * подписан на неё через Supabase Realtime: забирает строку, разбирает, пишет ей
 * первым через Telegram Desktop и отмечает результат в той же строке. Комп из
 * интернета не виден, поэтому таблица, а не прямой запрос на ПК.
 *
 * Токен — тот же, что у быстрой команды дашборда (profiles.sleep_webhook_token),
 * либо SOBLAZN_INTRO_SECRET из env, если задан. Supabase берётся из тех же env,
 * что и у остальных функций (SUPABASE_URL / VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
 *
 * Ответ — всегда plain text (быстрая команда показывает его уведомлением):
 * разбор строки бот делает за секунду, поэтому ошибка формата придёт сразу;
 * сама отправка дольше — тогда придёт «отправляю…», а итог бот напишет в личку.
 * { "dry": true } — только разобрать строку и показать приветствие, без отправки.
 */
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return text("POST only", 405);

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return text("функция не настроена: нет SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", 500);

  const raw = await req.text();
  let body: { token?: string; line?: string; dry?: boolean | string } = {};
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    body = { line: raw };
  }
  const fromHeader = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const token = (typeof body.token === "string" && body.token.trim()) || fromHeader;
  if (!token) return text("нет токена", 401);

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const secret = process.env.SOBLAZN_INTRO_SECRET;
  let authorized = !!secret && token === secret;
  if (!authorized) {
    const { data: profile, error } = await supabase.from("profiles").select("id").eq("sleep_webhook_token", token).maybeSingle();
    if (error) return text(`supabase: ${error.message}`, 500);
    authorized = !!profile;
  }
  if (!authorized) return text("неверный токен", 401);

  const line = String(body.line ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  if (!line) return text("пустая строка — нужен хотя бы логин (логин имя возраст сайт оценка)", 200);
  const dry = body.dry === true || body.dry === "true";

  const { data: row, error: insErr } = await supabase.from("soblazn_intros").insert({ line, dry }).select("id").single();
  if (insErr || !row) return text(`supabase: ${insErr?.message ?? "не смог записать"}`, 502);

  // Ждём ответ бота до ~6.5 с: ошибка разбора и dry приходят быстро, отправка — нет.
  const deadline = Date.now() + 6500;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 600));
    const { data } = await supabase.from("soblazn_intros").select("status,result").eq("id", row.id).single();
    if (!data) continue;
    if (data.status === "done" || data.status === "error") return text(data.result ?? data.status, 200);
    if (data.status === "taken" && data.result) return text(data.result, 200);
  }
  return text(`принято (#${row.id}), бот на компе пока молчит — занят или выключен. Строка дождётся его, итог придёт в личку Telegram.`, 200);
}

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}
