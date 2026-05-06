# Voice-driven micro-task — план реализации

Цель: нажатие Action button на iPhone → говоришь название задачи → текущая задача с таймером закрывается, новая создаётся (с правильной целью/категорией) и её таймер мгновенно стартует.

## Что уже готово в omnizen (использовать как есть)

База и RPC уже всё умеют — план не требует менять core domain, только добавить ingest-слой.

| Слой | Что есть | Файлы |
|---|---|---|
| Schema | `micro_tasks` (`timer_state` enum, `last_started_at`, `elapsed_seconds`, `goal_id`), `goals`, `task_categories`, `task_tags`, `task_category_links`, `task_category_buffers`, `profiles` | `supabase/migrations/20251115124215_*.sql`, `20251116181623_*.sql`, `20251116190000_*.sql`, `20260405000000_*.sql` |
| RPC старта таймера | `start_micro_task_timer(uuid)` — атомарно паузит любой другой running в том же widget и стартует этот | `20251116190000_*.sql` |
| RPC паузы | `pause_micro_task_timer(uuid)` — добавляет elapsed, ставит `paused`, чистит `last_started_at` | то же |
| RPC категорий | `attach_categories_to_task(task_id, category_ids[], user_id)` | `20251116181623_*.sql` |
| RPC тег+категория | `create_task_tag_with_category(name, user_id)` (если LLM захочет создать новый тег) | то же |
| Webhook-шаблон | `netlify/functions/sleep-webhook.ts` — bearer-токен из `profiles.sleep_webhook_token`, проверка, service-role write | `netlify/functions/sleep-webhook.ts` |
| Polling | `useMicroTasks` рефрешится каждые 10s (`refetchInterval: 10_000`) | `src/features/microTasks/hooks.ts` |

**Из этого следует:** ingest-функция должна сделать ровно 3 вещи через RPC, и виджет сам всё подхватит.

---

## Архитектура pipeline

```
iPhone Action button
    └─ iOS Shortcut: запись аудио (m4a) + POST с Bearer-токеном
        └─ Netlify Function /api/voice-microtask-webhook
            ├─ 1. Валидирует токен vs profiles.voice_webhook_token
            ├─ 2. Сохраняет audio в Supabase Storage (bucket "voice-recordings")
            ├─ 3. Создаёт row в voice_transcriptions (status="received")
            ├─ 4. STT (Groq Whisper → fallback OpenAI Whisper)
            ├─ 5. Записывает raw_transcript в row (status="transcribed")
            ├─ 6. LLM classify (Claude → fallback OpenAI)
            │     с контекстом: открытые goals, недавние micro_tasks, все task_categories
            ├─ 7. Apply action через RPCs:
            │     pause_micro_task_timer(running_id) если есть
            │     INSERT INTO micro_tasks(...)
            │     attach_categories_to_task(new_id, category_ids[], user_id)
            │     start_micro_task_timer(new_id)
            └─ 8. Записывает llm_output + applied_action_id (status="applied")
```

В UI: либо ждать 10s polling (как сейчас), либо подписаться на Realtime канал `voice_transcriptions` для мгновенного отклика.

---

## Что нужно построить

### 1. Миграция базы (`supabase/migrations/2026XXXXXXXXX_voice_microtask.sql`)

```sql
-- 1.1 Токен в профиле (по аналогии с sleep_webhook_token)
ALTER TABLE profiles ADD COLUMN voice_webhook_token uuid UNIQUE;

-- 1.2 Storage bucket "voice-recordings" — НЕ public, RLS:
--     INSERT/SELECT only by service-role (webhook) или owner (просмотр истории).
--     Делается отдельно через Supabase dashboard или supabase storage API.

-- 1.3 Таблица voice_transcriptions
CREATE TABLE voice_transcriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  audio_path   text NOT NULL,                 -- путь в Storage bucket
  raw_transcript text,                        -- сырой текст от Whisper, NULL при ошибке STT
  llm_output   jsonb,                         -- ответ LLM целиком
  applied_task_id uuid REFERENCES micro_tasks(id) ON DELETE SET NULL,
  paused_task_id  uuid REFERENCES micro_tasks(id) ON DELETE SET NULL,
  status       text NOT NULL CHECK (status IN
                  ('received','transcribed','classified','applied','error_stt','error_llm','error_apply')),
  error_detail text,                          -- человекочитаемая причина при ошибках
  duration_ms  integer,                       -- сколько занял весь pipeline
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);
ALTER TABLE voice_transcriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "voice_own_read" ON voice_transcriptions FOR SELECT USING (auth.uid() = user_id);
-- INSERT/UPDATE — только service-role (webhook). Никаких клиентских RLS на write.

-- 1.4 (Опционально, чище) RPC apply_voice_microtask_action
-- Атомарно: pause running + insert micro_task + attach_categories + start_timer.
-- Принимает payload, возвращает new_task_id.
-- Без этого webhook делает 4 отдельных RPC-вызова, что нормально, но при упадении
-- посередине состояние БД будет частично применено.
```

### 2. iOS Shortcut (вручную в приложении Команды)

**Важное отличие от подхода Артёма.** Его shortcut записывает аудио и сохраняет в iCloud-папку «Голосовые траты». Сервер потом сканирует папку через iCloud-mount на маке (`~/Library/Mobile Documents/com~apple~CloudDocs/`, см. `pipelines/steps/scan.py` и `core/models.py:168-172`). Это batch-механизм для batch-сценария (вечером свёл расходы за день).

**Тебе так нельзя**: Netlify serverless — нет всегда-запущенного watcher'а на iCloud. И главное — тебе нужно мгновенно стартануть таймер, а не «когда-нибудь обработать». Поэтому shortcut делает прямой POST.

**Действия в твоём shortcut (создать руками в приложении «Команды»):**

1. Команды → ➕ → назвать «Микрозадача».
2. Действия (по порядку):
   - **Записать звук** (Record Audio) → длительность «Остановить вручную», запрос подтверждения **OFF**.
   - **Получить содержимое URL** (Get Contents of URL):
     - URL: `https://omnizen.netlify.app/api/voice-microtask-webhook`
     - Метод: POST
     - Заголовки: `Authorization: Bearer <токен из profiles.voice_webhook_token>`
     - Тело запроса: **Form** (multipart) → добавить поле `audio` типа File = переменная «Записанный звук» из предыдущего шага.
   - (Опционально) **Показать уведомление** с результатом.
3. Settings → Action Button → System → Run Shortcut → выбрать «Микрозадача».

**Что НЕ нужно копировать у Артёма:**

- Его серверную генерацию `.shortcut` файлов с подписью через `shortcuts sign --mode anyone` (`api/shortcuts.py`, `host_proxy.py:191-220`) — это для multi-user проекта.
- Сохранение в iCloud-папку — у тебя нет всегда-включенного watcher'а.
- Cloudflare Access токены (`api/shortcuts.py:51-58`) — у тебя один пользователь, проще bearer-токен из `profiles`.

**Что уточнить у Артёма (если хочешь — но не обязательно):** он может прислать готовый `.shortcut` файл с уже настроенным POST'ом (а не его «расходы»-вариант с iCloud). В Командах можно «Поделиться → Файл .shortcut» и прислать его в Telegram. Но твой shortcut проще сделать вручную за 2 минуты, чем разбираться с его кастомным.

### 3. Netlify Function `netlify/functions/voice-microtask-webhook.ts`

Скелет (без полного кода — план):

```ts
// 1. Method check (POST only).
// 2. Auth: Bearer токен из Authorization header → SELECT user_id FROM profiles WHERE voice_webhook_token = token.
// 3. Прочитать multipart, достать audio blob.
// 4. Storage: upload в bucket "voice-recordings" по пути <user_id>/<yyyy-mm>/<uuid>.m4a.
// 5. INSERT voice_transcriptions(user_id, audio_path, status='received').
// 6. STT с fallback (см. § 4).
//    На ошибке: UPDATE row SET status='error_stt', error_detail=<msg>; return 200 (не падать).
// 7. UPDATE row SET raw_transcript=..., status='transcribed'.
// 8. Собрать LLM-контекст (см. § 5): query goals + recent micro_tasks + categories по user_id.
// 9. LLM classify с fallback (см. § 5). На ошибке: status='error_llm', return 200.
// 10. UPDATE row SET llm_output=..., status='classified'.
// 11. Apply action (см. § 6). На ошибке: status='error_apply'.
// 12. UPDATE row SET applied_task_id, paused_task_id, status='applied', duration_ms=...
```

Service-role key хранится в Netlify env var `SUPABASE_SERVICE_ROLE_KEY` (как сейчас у sleep-webhook).

### 4. STT — Whisper

**Primary: Groq Whisper API** (`whisper-large-v3-turbo`)
- Стоит ~$0.04/час аудио, латентность 1-3s на короткое аудио (5-15s).
- Endpoint: `https://api.groq.com/openai/v1/audio/transcriptions` (OpenAI-compatible).
- Env var: `GROQ_API_KEY`.

**Fallback: OpenAI Whisper API** (`whisper-1`)
- Чуть дороже, чуть медленнее, но супер-стабильный.
- Endpoint: `https://api.openai.com/v1/audio/transcriptions`.
- Env var: `OPENAI_API_KEY`.

**Алгоритм:**
```
try {
  result = await groqWhisper(audio, language='ru')
} catch {
  try {
    result = await openaiWhisper(audio, language='ru')
  } catch {
    save status='error_stt'; return 200
  }
}
```

**Что НЕ делать:** self-hosted Whisper как у Артёма (`mlx_whisper` / `faster-whisper` на маке через `litellm`). Артёму это надо потому что у него Cloudflare-tunnel в свой мак-мини. У тебя Netlify serverless — внешний Whisper API единственный реалистичный вариант.

### 5. LLM classification

**Single-stage** (не двухстадийный correction+extract как у Артёма — одна LLM-call решает всё).

**Primary: Claude (claude-3-5-haiku-latest или sonnet)**
- Быстрый, хороший с русским, нативный JSON через `tool_choice` или structured output.
- Env var: `ANTHROPIC_API_KEY`.

**Fallback: OpenAI gpt-4o-mini**
- Тот же интерфейс через `response_format: json_object`.

**Системный промпт (на рус, шаблон):**

```
Ты помощник, который превращает голосовую заметку в команду «начать микрозадачу».
Контекст пользователя:

ОТКРЫТЫЕ ЦЕЛИ (goals):
{goals_json}  // [{id, title}]

НЕДАВНИЕ МИКРОЗАДАЧИ (последние 30 дней, для матча по похожести):
{recent_tasks_json}  // [{id, title, category_names: [...], goal_id}]

ДОСТУПНЫЕ КАТЕГОРИИ:
{categories_json}  // [{id, name}]

Пользователь сказал:
"{transcript}"

Верни JSON:
{
  "new_task_title": string,           // нормализованное название задачи (короткое)
  "goal_id": uuid | null,             // если задача явно относится к цели
  "similar_task_id": uuid | null,     // если есть очень похожая задача — берём её категории
  "category_ids": uuid[],             // финальный список категорий (от similar_task ИЛИ свой выбор из доступных)
  "confidence": "high" | "medium" | "low"
}

Правила:
1. similar_task_id ставь только при очень высоком сходстве (одно и то же дело).
2. Если similar_task_id найден, category_ids = его категории, не выдумывай.
3. Если similar_task_id null — выбери 1-3 наиболее подходящие category_ids из ДОСТУПНЫХ. Не выдумывай новые.
4. goal_id ставь, только если связь с целью явная.
5. Никогда не возвращай ничего кроме JSON.
```

**Latency target:** 1.5-3s.

### 6. Apply action

```ts
// (а) если есть running task в том же widget — пауза:
const { data: running } = await supabase
  .from('micro_tasks')
  .select('id')
  .eq('user_id', userId)
  .eq('timer_state', 'running')
  .maybeSingle();
let pausedId = null;
if (running) {
  await supabase.rpc('pause_micro_task_timer', { p_task_id: running.id });
  pausedId = running.id;
}

// (б) Узнать widget_id "микрозадач". Хранить в profiles.voice_target_widget_id
// или искать первый widget с type='tasks' у юзера.
const widgetId = await resolveTargetWidget(userId);

// (в) Создать новую микрозадачу
const { data: newTask } = await supabase
  .from('micro_tasks')
  .insert({
    widget_id: widgetId,
    user_id: userId,
    title: llm.new_task_title,
    goal_id: llm.goal_id,
    timer_state: 'never',
    elapsed_seconds: 0,
  })
  .select()
  .single();

// (г) Прицепить категории
if (llm.category_ids?.length) {
  await supabase.rpc('attach_categories_to_task', {
    p_task_id: newTask.id,
    p_category_ids: llm.category_ids,
    p_user_id: userId,
  });
}

// (д) Стартануть таймер
await supabase.rpc('start_micro_task_timer', { p_task_id: newTask.id });

// (е) Запись в voice_transcriptions
await supabase.from('voice_transcriptions').update({
  applied_task_id: newTask.id,
  paused_task_id: pausedId,
  status: 'applied',
  duration_ms: Date.now() - startTime,
}).eq('id', voiceRowId);
```

### 7. UI — уведомления и история

**Минимум (работает без изменений):**
- Polling 10s в `useMicroTasks` сам подхватит изменения. Через ~10s после голоса в виджете задач: старая задача с галочкой/без таймера, новая — running.

**Лучше (для UX мгновенно):**
- Подписка на Realtime канал `voice_transcriptions` через `supabase.channel(...).on('postgres_changes', ...)`. При INSERT/UPDATE → `queryClient.invalidateQueries(['microTasks', widgetId])`. UI обновится за ~200ms.
- Toast «Записано: <title>» после `status='applied'`.
- Toast-ошибка «Не разобрал, аудио сохранено» при `status='error_*'` со ссылкой «прослушать запись» (signed URL на audio_path).

**Settings:**
- В существующем SettingsModal добавить блок «Голосовой webhook»: показать `voice_webhook_token`, кнопки «Скопировать» и «Перевыпустить». По образцу sleep-webhook.

### 8. Fallback-стратегия (резюме)

Каждый этап имеет резервный путь и **никогда не теряет данные**:

| Этап | Primary | Fallback | На полный фейл |
|---|---|---|---|
| Audio receive | Netlify | — | Если Netlify лежит → запрос упадёт на iPhone, юзер увидит ошибку команды (стандартный UX iOS). |
| Storage upload | Supabase Storage | Retry 3 раза | `voice_transcriptions.status='error_storage'`, `error_detail` хранит причину. Webhook возвращает 200. |
| STT | Groq Whisper | OpenAI Whisper | `status='error_stt'`, audio_path сохранён → можно перезапустить вручную. |
| LLM | Claude | OpenAI gpt-4o-mini | `status='error_llm'`, raw_transcript сохранён → можно создать задачу вручную с этим title. **Дополнительно: можно сделать «degraded mode»** — если LLM упал, создать микрозадачу с title=raw_transcript и без category_ids/goal_id, status='applied_degraded'. |
| Apply | RPC | — | `status='error_apply'`, можно повторить из UI («повторить применение»). |

Никакой crash не теряет audio: оно в Storage. Никакой crash не теряет transcript: он в DB. Худший сценарий — пользователь видит в истории voice_transcriptions row с error и кнопкой «применить вручную».

---

## Чек-лист по реализации (по этой ветке `voice-microtask-quick-start`)

В порядке зависимости:

- [ ] **0.** Решить с widget'ом-целью: где будет создаваться микрозадача? Один общий → добавить `profiles.voice_target_widget_id uuid`. Если автодетект первого `tasks`-виджета — не нужно.
- [ ] **1.** Миграция: `voice_transcriptions` table, `profiles.voice_webhook_token`, RLS, (опц) RPC `apply_voice_microtask_action`.
- [ ] **2.** Storage bucket `voice-recordings` (через dashboard или supabase storage CLI).
- [ ] **3.** Env vars в Netlify: `GROQ_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`. Service-role уже есть.
- [ ] **4.** `netlify/functions/voice-microtask-webhook.ts` — auth + storage + STT + LLM + apply, с fallback'ами.
- [ ] **5.** Smoke-тест: `curl -X POST -H "Authorization: Bearer $TOKEN" -F audio=@test.m4a $URL`. Проверить что row появился, status='applied', timer стартовал.
- [ ] **6.** Settings UI — отрисовать токен, генерация/ротация (по аналогии sleep_webhook_token из `SettingsModal.tsx`).
- [ ] **7.** iOS Shortcut: создать вручную, проверить с боевого iPhone.
- [ ] **8.** Realtime subscription в `useMicroTasks` (или отдельный хук) для мгновенного UI после голоса.
- [ ] **9.** Smoke-тесты в `scripts/smoke.ts`: вызов webhook'а с фейк-audio (можно skip STT через env флаг и сразу класть mock transcript), проверка применения.

## Что НЕ делать (anti-pattern из Артёма)

- ❌ Серверная генерация `.shortcut` файлов с подписью. Один пользователь — один shortcut, делается руками.
- ❌ Self-hosted Whisper. У тебя нет всегда-включенного мака с MLX. Облачные API быстрее и стабильнее в твоём случае.
- ❌ Двухстадийный LLM (correction → extraction). Современные модели справляются за один вызов с грязным русским транскриптом.
- ❌ Celery/Redis/queue. Один webhook = один синхронный pipeline, занимает 3-5s. Если нужно асинхронно — дёшево добавить позже через Supabase Edge Functions, но пока не нужно.
- ❌ DAG из `Pipeline`/`PipelineNode`. Это конструктор для разных типов команд (траты, покупки, задачи). У тебя один сценарий — линейный код в одной функции.

---

## Что попросить у Артёма

**По существу — НИЧЕГО критичного.** Его shortcut (записать → сохранить в iCloud) у тебя не работает. Его системный промпт `extract_tasks` (`fixtures/initial_data.json:211-220`) можно посмотреть для референса, но твоя задача (start a micro-task) не та же что у него (extract a list of tasks из голосовой заметки) — промпт нужен другой.

**Опционально — для интереса:**

- Какие у него env vars в `.env` для Whisper-сервера и LLM (`WHISPER_MODEL`, какой LLM выбран в `AppConfig.llm_model`).
- Запросы к claude-cli и gemini в его `litellm_config.yaml` — чисто посмотреть.
- Его текущая стоимость пайплайна (audio → запись в БД) — сколько секунд занимает.

Но **архитектурно ты не воспроизводишь** ничего из его системы:

| Его компонент | Зачем у него | Тебе не нужен потому что |
|---|---|---|
| Generator `.shortcut` файлов (`api/shortcuts.py`) | Раздавать новым пользователям подписанные shortcuts | Один пользователь — shortcut руками |
| Подпись через `shortcuts sign` (`host_proxy.py:191`) | Чтобы non-trusted shortcuts ставились на iPhone | Свой shortcut доверенный |
| iCloud watcher / scan_audio_folder | Batch-обработка вечером | Тебе нужно мгновенно — webhook |
| Cloudflare Access service tokens | Не светить Supabase JWT в shortcut'е, многопользовательская система | Bearer-токен из `profiles` достаточно |
| Self-hosted MLX/faster-whisper + LiteLLM gateway | Mac с GPU всегда онлайн, дёшево | Netlify serverless — облачный API |
| Pipeline DAG (`Pipeline`/`PipelineNode`/`PipelineRun`) | Конструктор для разных типов команд | Один сценарий — линейная функция |
| Двухстадийный LLM (`llm_correction` → `extract_*`) | Whisper-low-quality на старых моделях | Whisper-large-v3-turbo сразу даёт чистый текст |
| Celery + Redis | Длинные DAG'и с резюм | Один webhook = синхронный pipeline 3-5s |
