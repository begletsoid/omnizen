import { useCallback, useEffect, useState, type ChangeEvent } from 'react';

import { useBootstrapDashboard } from '../features/dashboards/hooks';
import {
  useEnsureSleepToken,
  useEnsureVoiceToken,
  useProfile,
  useRotateSleepToken,
  useRotateVoiceToken,
  useSetVoiceTargetGoalsWidget,
  useSetVoiceTargetWidget,
  useUpdateVoiceIntentRules,
} from '../features/profile/hooks';

// Intents the user can map keywords to. Stays in sync with INTENT_REGISTRY
// in netlify/functions/_voice/intents.ts. Hardcoded list because the
// frontend can't import server-side code; small price for keeping the
// intent registry server-only (avoids leaking SQL into the bundle).
const VOICE_INTENT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'start_microtask', label: 'Начать микрозадачу (find-or-create)' },
  { value: 'pause_current', label: 'Поставить таймер на паузу' },
  { value: 'add_goal', label: 'Создать новую цель' },
  { value: 'undo_last', label: 'Откатить предыдущую команду' },
];

type SettingsModalProps = {
  userId: string | null;
  onClose: () => void;
};

type CopyKind = 'url' | 'token' | 'voice_url' | 'voice_token';

export function SettingsModal({ userId, onClose }: SettingsModalProps) {
  const { data: profile } = useProfile(userId);
  const { data: bootstrap } = useBootstrapDashboard(userId);
  const ensureToken = useEnsureSleepToken(userId);
  const rotateToken = useRotateSleepToken(userId);
  const ensureVoiceToken = useEnsureVoiceToken(userId);
  const rotateVoiceToken = useRotateVoiceToken(userId);
  const setVoiceTargetWidget = useSetVoiceTargetWidget(userId);
  const setVoiceTargetGoalsWidget = useSetVoiceTargetGoalsWidget(userId);
  const updateVoiceRules = useUpdateVoiceIntentRules(userId);
  const [copied, setCopied] = useState<CopyKind | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [showVoiceToken, setShowVoiceToken] = useState(false);
  // Local draft of the rules being edited — kept here so the user can type
  // a new keyword without each keystroke firing a mutation. Saved on blur
  // / Enter / explicit "Add" via setRulesDraft -> mutation.
  const [rulesDraft, setRulesDraft] = useState<Array<{ keyword: string; intent: string }>>([]);
  const [rulesDirty, setRulesDirty] = useState(false);

  // Make sure a token exists the moment the modal opens — users who never
  // rotated just see it populated automatically. Same lazy-init for voice.
  useEffect(() => {
    if (!userId) return;
    if (profile && !profile.sleep_webhook_token && !ensureToken.isPending) {
      ensureToken.mutate();
    }
  }, [userId, profile, ensureToken]);
  useEffect(() => {
    if (!userId) return;
    if (profile && !profile.voice_webhook_token && !ensureVoiceToken.isPending) {
      ensureVoiceToken.mutate();
    }
  }, [userId, profile, ensureVoiceToken]);

  // Hardcoded prod URL: the iOS Shortcut runs on a phone, which can't reach
  // localhost. Even when the user has the dashboard open in dev mode the
  // webhook they need to put in Shortcuts is the public Netlify Function.
  const webhookUrl = 'https://omnizen.netlify.app/api/sleep-webhook';
  const voiceWebhookUrl = 'https://omnizen.netlify.app/api/voice-microtask-webhook';
  const token = profile?.sleep_webhook_token ?? '';
  const voiceToken = profile?.voice_webhook_token ?? '';
  const tz = profile?.timezone ?? 'UTC';
  const lastBedtime = profile?.last_bedtime_at ?? null;
  const voiceTargetWidgetId = profile?.voice_target_widget_id ?? null;
  const voiceTargetGoalsWidgetId = profile?.voice_target_goals_widget_id ?? null;
  const tasksWidgets = (bootstrap?.widgets ?? []).filter((w) => w.type === 'tasks');
  const goalsWidgets = (bootstrap?.widgets ?? []).filter((w) => w.type === 'goals');

  // Sync the rules editor draft from server state when the profile loads or
  // when an external change updates voice_intent_rules.
  useEffect(() => {
    if (!profile) return;
    if (rulesDirty) return; // user is editing — don't clobber their draft
    const entries = Object.entries(profile.voice_intent_rules ?? {}).map(
      ([keyword, intent]) => ({ keyword, intent }),
    );
    setRulesDraft(entries);
  }, [profile, rulesDirty]);

  const persistRules = useCallback(
    (entries: Array<{ keyword: string; intent: string }>) => {
      const map: Record<string, string> = {};
      for (const { keyword, intent } of entries) {
        const k = keyword.trim().toLowerCase();
        if (k && intent) map[k] = intent;
      }
      updateVoiceRules.mutate(map);
      setRulesDirty(false);
    },
    [updateVoiceRules],
  );

  const handleRuleKeywordChange = (idx: number, value: string) => {
    setRulesDraft((prev) => prev.map((r, i) => (i === idx ? { ...r, keyword: value } : r)));
    setRulesDirty(true);
  };
  const handleRuleIntentChange = (idx: number, value: string) => {
    setRulesDraft((prev) => {
      const next = prev.map((r, i) => (i === idx ? { ...r, intent: value } : r));
      // Intent change is committal — persist immediately (the dropdown isn't
      // something the user "types into", so no debounce needed).
      persistRules(next);
      return next;
    });
  };
  const handleRuleBlur = () => {
    if (rulesDirty) persistRules(rulesDraft);
  };
  const handleAddRule = () => {
    setRulesDraft((prev) => [...prev, { keyword: '', intent: 'start_microtask' }]);
    setRulesDirty(true);
  };
  const handleRemoveRule = (idx: number) => {
    setRulesDraft((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      persistRules(next);
      return next;
    });
  };

  const copy = useCallback(
    async (kind: CopyKind, value: string) => {
      try {
        await navigator.clipboard.writeText(value);
        setCopied(kind);
        setTimeout(() => setCopied(null), 1500);
      } catch {
        // No-op — graceful fallback, the user can still select & copy manually.
      }
    },
    [],
  );

  const handleRotate = () => {
    if (rotateToken.isPending) return;
    if (!confirm('Сгенерировать новый токен? Старый перестанет работать — нужно будет обновить iOS Shortcut.')) return;
    rotateToken.mutate();
  };

  const handleRotateVoice = () => {
    if (rotateVoiceToken.isPending) return;
    if (!confirm('Сгенерировать новый голосовой токен? Старый перестанет работать — нужно будет обновить iOS Shortcut «Voice Microtask».')) return;
    rotateVoiceToken.mutate();
  };

  const handleSelectTargetWidget = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    setVoiceTargetWidget.mutate(value === '' ? null : value);
  };

  const handleSelectTargetGoalsWidget = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    setVoiceTargetGoalsWidget.mutate(value === '' ? null : value);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Настройки"
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      tabIndex={-1}
    >
      <div
        className="w-full max-w-lg rounded-3xl border border-white/10 bg-background/95 p-6 text-sm text-text shadow-2xl backdrop-blur"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Настройки</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="rounded-full border border-white/10 px-3 py-0.5 text-xs text-muted transition hover:border-white/30 hover:text-text"
          >
            ✕
          </button>
        </div>

        <section className="mb-4">
          <h3 className="mb-2 text-xs uppercase tracking-widest text-muted">Часовой пояс</h3>
          <p className="text-xs text-muted">
            Определён автоматически из системы iPhone/компьютера — не зависит от VPN.
          </p>
          <p className="mt-1 font-mono text-xs text-text">{tz}</p>
        </section>

        <section className="mb-4">
          <h3 className="mb-2 text-xs uppercase tracking-widest text-muted">Автоочистка после пробуждения</h3>
          <p className="text-xs text-muted">
            Когда iPhone присылает время отбоя (через iOS Shortcut при пробуждении),
            сервер сразу ставит на паузу последний запущенный таймер (отсекая время после
            того, как ты лёг), архивирует все задачи с &gt;5 сек на таймере и удаляет пустышки.
          </p>
          <p className="mt-2 text-xs text-muted">
            Момент «когда ты лёг» читается из Apple Watch через iOS-команду (ниже).
            <span className="mx-1">Последнее полученное значение:</span>
            <span className="font-mono text-text">
              {lastBedtime ? new Date(lastBedtime).toLocaleString('ru-RU') : '—'}
            </span>
          </p>
        </section>

        <section className="mb-4">
          <h3 className="mb-2 text-xs uppercase tracking-widest text-muted">URL вебхука</h3>
          <div className="flex items-stretch gap-2">
            <input
              readOnly
              value={webhookUrl}
              className="min-w-0 flex-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 font-mono text-xs text-text outline-none"
            />
            <button
              type="button"
              onClick={() => copy('url', webhookUrl)}
              className="rounded-md border border-white/20 px-3 text-xs text-muted transition hover:border-white/40 hover:text-text"
            >
              {copied === 'url' ? 'Скопировано' : 'Копировать'}
            </button>
          </div>
        </section>

        <section className="mb-4">
          <h3 className="mb-2 flex items-center justify-between text-xs uppercase tracking-widest text-muted">
            Токен
            <button
              type="button"
              onClick={handleRotate}
              disabled={rotateToken.isPending}
              className="rounded-full border border-white/10 px-2.5 py-0.5 text-[0.65rem] normal-case tracking-normal text-muted transition hover:border-rose-400/40 hover:text-rose-200 disabled:opacity-50"
            >
              Перегенерировать
            </button>
          </h3>
          <div className="flex items-stretch gap-2">
            <input
              readOnly
              type={showToken ? 'text' : 'password'}
              value={token}
              className="min-w-0 flex-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 font-mono text-xs text-text outline-none"
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              aria-label={showToken ? 'Скрыть токен' : 'Показать токен'}
              className="rounded-md border border-white/20 px-3 text-xs text-muted transition hover:border-white/40 hover:text-text"
            >
              {showToken ? '🙈' : '👁'}
            </button>
            <button
              type="button"
              onClick={() => copy('token', token)}
              disabled={!token}
              className="rounded-md border border-white/20 px-3 text-xs text-muted transition hover:border-white/40 hover:text-text disabled:opacity-50"
            >
              {copied === 'token' ? 'Скопировано' : 'Копировать'}
            </button>
          </div>
        </section>

        <section>
          <details className="text-xs text-muted">
            <summary className="cursor-pointer select-none text-text">
              Как настроить iOS Shortcut (5 мин)
            </summary>

            <p className="mt-2">
              iPhone отдаёт сырые семплы шагов за последние сутки, сервер сам находит самый
              длинный период бездействия и считает его время начала за момент отбоя. Такой
              подход устойчив к ночным походам в туалет (1-2 коротких всплеска шагов
              внутри ночи алгоритм поглощает) и не зависит от Sleep Focus.
            </p>

            <ol className="ml-5 mt-3 list-decimal space-y-2">
              <li>
                <b>Shortcuts → «Автоматизация» → «+» → «Сон» → «Пробуждение».</b> Нажми
                «Готово» — откроется редактор команды.
              </li>
              <li>
                Добавь action <b>«Найти образцы Здоровья»</b> (Find Health Samples):
                <ul className="ml-4 mt-1 list-disc space-y-0.5 text-muted">
                  <li>Тип: <code>Steps</code> (Шаги).</li>
                  <li>Фильтр: <code>Start Date · в последн. · 1 · день</code>.</li>
                  <li>Сортировка: <code>Start Date</code>, по возрастанию.</li>
                  <li>
                    Лимит: <b>отключи</b> переключатель «Ограничение». Серверу нужны все
                    семплы за день — обычно их 30-100 штук.
                  </li>
                </ul>
              </li>
              <li>
                Добавь action <b>«Повторить с каждым»</b> (Repeat with Each), вход —
                результат предыдущего шага. Внутри цикла:
                <ul className="ml-4 mt-1 list-disc space-y-0.5 text-muted">
                  <li>
                    <b>Получить подробные сведения о Здоровье</b>: свойство <code>Start Date</code>.
                    Затем <b>Форматировать дату</b> с заказным форматом{' '}
                    <code>yyyy-MM-dd&apos;T&apos;HH:mm:ssXXX</code> → переменная-результат A.
                  </li>
                  <li>
                    Ещё <b>Получить подробные сведения</b>: свойство <code>End Date</code>{' '}
                    + <b>Форматировать дату</b> тем же форматом → переменная-результат B.
                  </li>
                  <li>
                    Ещё <b>Получить подробные сведения</b>: свойство{' '}
                    <code>Quantity</code> (количество шагов) → переменная-результат C.
                  </li>
                  <li>
                    Action <b>«Словарь»</b>: создай объект с тремя ключами{' '}
                    <code>start</code> = A, <code>end</code> = B, <code>value</code> = C.
                  </li>
                </ul>
                После цикла переменная «Результат повторения» — это массив словарей.
              </li>
              <li>
                Action <b>«Словарь»</b> (вне цикла): создай <code>{'{ step_samples: <Результат повторения> }'}</code>.
              </li>
              <li>
                Action <b>«Получить содержимое URL»</b>:
                <ul className="ml-4 mt-1 list-disc space-y-0.5 text-muted">
                  <li>URL: тот, что в этом окне выше.</li>
                  <li>Метод: <code>POST</code>.</li>
                  <li>
                    Заголовки: <code>Content-Type: application/json</code> и{' '}
                    <code>Authorization: Bearer {token || '<твой-токен>'}</code>.
                  </li>
                  <li>
                    Тело запроса: <b>Файл</b> → выбрать словарь из шага 4 (или
                    Body type «JSON» → передать тот словарь).
                  </li>
                </ul>
              </li>
              <li>
                Вернись к списку автоматизаций, открой свою, и <b>отключи переключатель
                «Спрашивать до запуска»</b>. Иначе iOS будет просить подтверждение каждое
                утро.
              </li>
            </ol>

            <p className="mt-3">
              Проверка: нажми на команду «Воспроизвести» вручную — тест должен вернуть <code>204</code>.
              В этом же окне в блоке «Автоочистка» появится «Последнее полученное значение»
              с датой — значит всё доходит.
            </p>
          </details>
        </section>

        <section className="mb-4 mt-6 border-t border-white/10 pt-4">
          <h3 className="mb-2 text-xs uppercase tracking-widest text-muted">
            Голосовая микрозадача
          </h3>
          <p className="mb-3 text-xs text-muted">
            Нажмёшь Action Button на iPhone, скажешь название задачи — текущая задача
            автоматически паузится, новая создаётся и её таймер стартует. Распознавание
            и классификация на стороне сервера, ~3-5 сек.
          </p>
        </section>

        <section className="mb-4">
          <h3 className="mb-2 text-xs uppercase tracking-widest text-muted">
            URL вебхука (голос)
          </h3>
          <div className="flex items-stretch gap-2">
            <input
              readOnly
              value={voiceWebhookUrl}
              className="min-w-0 flex-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 font-mono text-xs text-text outline-none"
            />
            <button
              type="button"
              onClick={() => copy('voice_url', voiceWebhookUrl)}
              className="rounded-md border border-white/20 px-3 text-xs text-muted transition hover:border-white/40 hover:text-text"
            >
              {copied === 'voice_url' ? 'Скопировано' : 'Копировать'}
            </button>
          </div>
        </section>

        <section className="mb-4">
          <h3 className="mb-2 flex items-center justify-between text-xs uppercase tracking-widest text-muted">
            Токен (голос)
            <button
              type="button"
              onClick={handleRotateVoice}
              disabled={rotateVoiceToken.isPending}
              className="rounded-full border border-white/10 px-2.5 py-0.5 text-[0.65rem] normal-case tracking-normal text-muted transition hover:border-rose-400/40 hover:text-rose-200 disabled:opacity-50"
            >
              Перегенерировать
            </button>
          </h3>
          <div className="flex items-stretch gap-2">
            <input
              readOnly
              type={showVoiceToken ? 'text' : 'password'}
              value={voiceToken}
              className="min-w-0 flex-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 font-mono text-xs text-text outline-none"
            />
            <button
              type="button"
              onClick={() => setShowVoiceToken((v) => !v)}
              aria-label={showVoiceToken ? 'Скрыть токен' : 'Показать токен'}
              className="rounded-md border border-white/20 px-3 text-xs text-muted transition hover:border-white/40 hover:text-text"
            >
              {showVoiceToken ? '🙈' : '👁'}
            </button>
            <button
              type="button"
              onClick={() => copy('voice_token', voiceToken)}
              disabled={!voiceToken}
              className="rounded-md border border-white/20 px-3 text-xs text-muted transition hover:border-white/40 hover:text-text disabled:opacity-50"
            >
              {copied === 'voice_token' ? 'Скопировано' : 'Копировать'}
            </button>
          </div>
        </section>

        <section className="mb-4">
          <h3 className="mb-2 text-xs uppercase tracking-widest text-muted">
            Виджет для новых задач
          </h3>
          <p className="mb-1 text-xs text-muted">
            В каком виджете создавать микрозадачи, услышанные с iPhone. Если не выбрано —
            при первом голосе используется первый по порядку <code>tasks</code>-виджет
            и сохраняется здесь автоматически.
          </p>
          {tasksWidgets.length === 0 ? (
            <p className="text-xs text-rose-300">
              Нет виджетов типа «Микрозадачи». Добавь хотя бы один на дашборде.
            </p>
          ) : (
            <select
              value={voiceTargetWidgetId ?? ''}
              onChange={handleSelectTargetWidget}
              disabled={setVoiceTargetWidget.isPending}
              className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-text outline-none disabled:opacity-50"
            >
              <option value="">— автоматически (первый виджет) —</option>
              {tasksWidgets.map((widget) => {
                const title = (widget.config?.title as string | undefined) ?? widget.id.slice(0, 8);
                return (
                  <option key={widget.id} value={widget.id}>
                    {title}
                  </option>
                );
              })}
            </select>
          )}
        </section>

        <section className="mb-4">
          <h3 className="mb-2 text-xs uppercase tracking-widest text-muted">
            Виджет для новых целей
          </h3>
          <p className="mb-1 text-xs text-muted">
            В каком виджете создавать цели по команде «добавь цель …». Если не выбрано —
            при первой такой команде используется первый <code>goals</code>-виджет
            и сохраняется здесь автоматически.
          </p>
          {goalsWidgets.length === 0 ? (
            <p className="text-xs text-rose-300">
              Нет виджетов типа «Цели». Добавь хотя бы один на дашборде.
            </p>
          ) : (
            <select
              value={voiceTargetGoalsWidgetId ?? ''}
              onChange={handleSelectTargetGoalsWidget}
              disabled={setVoiceTargetGoalsWidget.isPending}
              className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-text outline-none disabled:opacity-50"
            >
              <option value="">— автоматически (первый виджет) —</option>
              {goalsWidgets.map((widget) => {
                const title = (widget.config?.title as string | undefined) ?? widget.id.slice(0, 8);
                return (
                  <option key={widget.id} value={widget.id}>
                    {title}
                  </option>
                );
              })}
            </select>
          )}
        </section>

        <section className="mb-4">
          <h3 className="mb-2 flex items-center justify-between text-xs uppercase tracking-widest text-muted">
            Голосовые правила (keyword → команда)
            <button
              type="button"
              onClick={handleAddRule}
              className="rounded-full border border-white/10 px-2.5 py-0.5 text-[0.65rem] normal-case tracking-normal text-muted transition hover:border-white/40 hover:text-text"
            >
              + правило
            </button>
          </h3>
          <p className="mb-2 text-xs text-muted">
            Если фраза содержит ключевое слово, LLM должен предпочесть указанную команду.
            Дефолтные правила: <code>отмена → undo_last</code>, <code>стоп / пауза → pause_current</code>,
            <code> добавь цель → add_goal</code>.
          </p>
          {rulesDraft.length === 0 ? (
            <p className="text-xs text-muted">Правил нет — LLM решает сам по смыслу фразы.</p>
          ) : (
            <ul className="space-y-1">
              {rulesDraft.map((rule, idx) => (
                <li key={idx} className="flex items-stretch gap-1.5">
                  <input
                    type="text"
                    placeholder="ключевое слово"
                    value={rule.keyword}
                    onChange={(e) => handleRuleKeywordChange(idx, e.target.value)}
                    onBlur={handleRuleBlur}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur();
                      }
                    }}
                    className="min-w-0 flex-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-text outline-none"
                  />
                  <select
                    value={rule.intent}
                    onChange={(e) => handleRuleIntentChange(idx, e.target.value)}
                    className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-text outline-none"
                  >
                    {VOICE_INTENT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => handleRemoveRule(idx)}
                    aria-label="Удалить правило"
                    className="rounded-md border border-white/10 px-2 text-xs text-muted transition hover:border-rose-400/40 hover:text-rose-200"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <details className="text-xs text-muted">
            <summary className="cursor-pointer select-none text-text">
              Как настроить iOS Shortcut (5 действий)
            </summary>

            <p className="mt-2">
              Простой shortcut: записал → отправил → получил уведомление с результатом.
              Без сохранения на диск — если интернета нет, iOS просто покажет ошибку и ты
              скажешь команду повторно.
            </p>

            <p className="mt-2 font-semibold text-text">Команда «Voice Microtask»</p>
            <ol className="ml-5 mt-2 list-decimal space-y-2">
              <li>
                <b>Команды → ➕ → новая команда</b>, назвать «Voice Microtask».
              </li>
              <li>
                Action <b>«Записать звук»</b>: окончание <code>По нажатию</code>,
                качество <code>Обычное</code>, показывать индикатор записи <code>Вкл</code>.
              </li>
              <li>
                Action <b>«Случайное число»</b> от <code>0</code> до <code>9999999999</code>.
                Эта переменная пойдёт как <code>idempotency_key</code> — защищает от дубликатов
                при повторных нажатиях.
              </li>
              <li>
                Action <b>«Получить содержимое URL»</b>:
                <ul className="ml-4 mt-1 list-disc space-y-0.5 text-muted">
                  <li>URL: <code>{voiceWebhookUrl}</code>.</li>
                  <li>Метод: <code>POST</code>.</li>
                  <li>
                    Заголовок: <code>Authorization: Bearer {voiceToken || '<твой-токен>'}</code>.
                  </li>
                  <li>
                    Тело запроса: <code>Форма</code> (Multipart Form), два поля:
                    <ul className="ml-4 list-disc">
                      <li><code>audio</code> — тип <b>Файл</b>, значение «Записанный звук».</li>
                      <li><code>idempotency_key</code> — тип <b>Текст</b>, значение «Случайное число».</li>
                    </ul>
                  </li>
                </ul>
              </li>
              <li>
                Action <b>«Получить словарь из ввода»</b> → вход «Содержимое URL» из шага 4.
                Это превратит JSON-ответ в словарь, чтобы можно было доставать поля по ключу.
              </li>
              <li>
                Action <b>«Получить значение словаря»</b>: ключ <code>summary_title</code>,
                словарь — переменная из шага 5. Переименуй результирующую переменную в <b>«Заголовок»</b>
                (тапни на действие → «Переименовать переменную»).
              </li>
              <li>
                Ещё раз action <b>«Получить значение словаря»</b>: ключ <code>summary_body</code>,
                тот же словарь. Переименуй в <b>«Текст»</b>.
              </li>
              <li>
                Action <b>«Показать уведомление»</b>:
                <ul className="ml-4 mt-1 list-disc space-y-0.5 text-muted">
                  <li>В поле основного содержимого вставь переменную <b>«Текст»</b>.</li>
                  <li>В разделе <b>Заголовок</b> (раскрой ▾) вставь переменную <b>«Заголовок»</b>.</li>
                  <li>«Воспроизвести звук»: на вкус.</li>
                </ul>
              </li>
              <li>
                Привязать: <b>Настройки iPhone → Action Button → Команда → Voice Microtask</b>.
              </li>
            </ol>

            <p className="mt-2 text-muted">
              Если переменные «Заголовок»/«Текст» переименовать не получается — это нормально,
              просто вставляй «Значение словаря» (последнее) для текста, а «Значение словаря»
              из шага 6 — для заголовка. iOS подсказывает какая переменная из какого шага.
            </p>

            <p className="mt-2">
              <b>Альтернатива (одна строка):</b> вместо шагов 5-7 можешь просто взять одно
              «Получить значение словаря» с ключом <code>summary</code> и вставить его как
              текст уведомления — тогда заголовок и тело идут одной строкой
              «Создана задача. «X». Таймер запущен.» Это попроще, но в уведомлении
              не будет жирного заголовка.
            </p>

            <p className="mt-3">
              <b>Первый запуск:</b> iOS попросит доступ к микрофону и сети — одобри.
              На залоченном iPhone Action Button сначала попросит FaceID — это нужно
              чтобы появилась кнопка «Стоп» записи.
            </p>
          </details>
        </section>
      </div>
    </div>
  );
}
