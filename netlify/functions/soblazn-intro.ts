import { createClient } from "@supabase/supabase-js";

/**
 * soblazn → «начни с ней» с телефона.
 *
 * Быстрая команда на iPhone шлёт сюда POST с одной строкой:
 *     { "line": "anna_k Аня 24 pure 80" }
 * и заголовком Authorization: Bearer <токен> — тем же, что у остальных
 * быстрых команд дашборда (profiles.voice_webhook_token или
 * profiles.sleep_webhook_token, оба принимаются). Токен можно передать и
 * полем "token" в теле. Отдельный SOBLAZN_INTRO_SECRET в env — по желанию.
 * Строка строго: логин имя возраст сайт оценка, пропуск — «-».
 *
 * Тело принимаем в любом виде, в каком его умеет слать Shortcuts: JSON
 * (поле line / text / input / message / строка — или единственное строковое
 * поле), форма (urlencoded / multipart) с теми же именами, либо просто текст.
 * Если строку так и не нашли — записываем в таблицу, что пришло (тип тела,
 * имена полей, начало сырого тела): это и есть лог, его читает Макс/Claude.
 *
 * Функция кладёт строку в таблицу soblazn_intros. Бот soblazn на компе Макса
 * подписан на неё через Supabase Realtime: забирает строку, разбирает, пишет ей
 * первым через Telegram Desktop и отмечает результат в той же строке. Комп из
 * интернета не виден, поэтому таблица, а не прямой запрос на ПК.
 *
 * Ответ — всегда plain text (быстрая команда показывает его уведомлением):
 * разбор строки бот делает за секунду, поэтому ошибка формата придёт сразу;
 * сама отправка дольше — тогда придёт «отправляю…», а итог бот напишет в личку.
 * { "dry": true } — только разобрать строку и показать приветствие, без отправки.
 */

const LINE_KEYS = ["line", "text", "input", "message", "msg", "q", "строка", "ввод", "текст"];

interface Parsed {
  line: string;
  token: string;
  dry: boolean;
  keys: string[];
  how: string;
}

function parseBody(raw: string, contentType: string): Parsed {
  const ct = contentType.toLowerCase();
  let fields: Record<string, string> = {};
  let how = "text";
  const trimmed = raw.trim();

  if (trimmed.startsWith("{")) {
    try {
      const j = JSON.parse(trimmed) as Record<string, unknown>;
      how = "json";
      for (const [k, v] of Object.entries(j)) {
        if (typeof v === "string") fields[k] = v;
        else if (typeof v === "number" || typeof v === "boolean") fields[k] = String(v);
        else if (Array.isArray(v)) fields[k] = v.map((x) => String(x)).join(" ");
      }
    } catch {
      how = "json-broken";
    }
  } else if (ct.includes("multipart/form-data")) {
    how = "multipart";
    const re = /name="([^"]+)"[^\r\n]*\r?\n\r?\n([\s\S]*?)\r?\n--/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw))) fields[m[1]!] = (m[2] ?? "").trim();
  } else if (ct.includes("application/x-www-form-urlencoded") || (/^[^=\s]+=/.test(trimmed) && !trimmed.includes(" "))) {
    how = "form";
    fields = Object.fromEntries(new URLSearchParams(trimmed));
  }

  const keys = Object.keys(fields);
  const lower = (k: string) => k.toLowerCase().trim();
  let line = "";
  for (const key of LINE_KEYS) {
    const hit = keys.find((k) => lower(k) === key);
    if (hit && fields[hit]!.trim()) {
      line = fields[hit]!;
      break;
    }
  }
  const token = keys.map((k) => (lower(k) === "token" ? fields[k]! : "")).find(Boolean) ?? "";
  const dryRaw = keys.map((k) => (lower(k) === "dry" ? fields[k]! : "")).find(Boolean) ?? "";
  if (!line && how !== "json" && how !== "multipart" && how !== "form") line = trimmed; // просто текст
  if (!line) {
    // Единственное строковое поле, кроме служебных, — это и есть строка.
    const rest = keys.filter((k) => !["token", "dry"].includes(lower(k)) && fields[k]!.trim());
    if (rest.length === 1) line = fields[rest[0]!]!;
  }
  return { line, token, dry: /^(true|1|yes|да|истина)$/i.test(dryRaw.trim()), keys, how };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return text("POST only", 405);

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return text("функция не настроена: нет SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", 500);

  const raw = await req.text();
  const contentType = req.headers.get("content-type") ?? "";
  const body = parseBody(raw, contentType);

  const fromHeader = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const token = fromHeader || body.token;
  if (!token) return text("нет токена: нужен заголовок Authorization: Bearer <токен дашборда>", 401);

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const secret = process.env.SOBLAZN_INTRO_SECRET;
  let authorized = !!secret && token === secret;
  if (!authorized) {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id")
      .or(`voice_webhook_token.eq.${token},sleep_webhook_token.eq.${token}`)
      .maybeSingle();
    if (error) return text(`supabase: ${error.message}`, 500);
    authorized = !!profile;
  }
  if (!authorized) return text("неверный токен", 401);

  const line = body.line.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!line) {
    // Ничего похожего на строку — записываем улику в таблицу и отвечаем ею же.
    const why =
      `тело: ${body.how}, content-type «${contentType || "нет"}», поля: ${body.keys.length ? body.keys.join(", ") : "нет"}; ` +
      `сырое (${raw.length} симв.): «${raw.replace(/\s+/g, " ").slice(0, 160)}»`;
    await supabase.from("soblazn_intros").insert({ line: "(пусто)", dry: body.dry, status: "error", result: `✗ строка не пришла — ${why}` });
    return text(`✗ строка не пришла. ${why}. Нужно поле line в JSON: {"line": "anna_k Аня 24 pure 80"}`, 200);
  }

  const { data: row, error: insErr } = await supabase.from("soblazn_intros").insert({ line, dry: body.dry }).select("id").single();
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
