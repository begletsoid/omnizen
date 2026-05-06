import { useCallback, useEffect, useState, type ChangeEvent } from 'react';

import { useBootstrapDashboard } from '../features/dashboards/hooks';
import {
  useEnsureSleepToken,
  useEnsureVoiceToken,
  useProfile,
  useRotateSleepToken,
  useRotateVoiceToken,
  useSetVoiceTargetWidget,
} from '../features/profile/hooks';

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
  const [copied, setCopied] = useState<CopyKind | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [showVoiceToken, setShowVoiceToken] = useState(false);

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
  const tasksWidgets = (bootstrap?.widgets ?? []).filter((w) => w.type === 'tasks');

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

        <section>
          <details className="text-xs text-muted">
            <summary className="cursor-pointer select-none text-text">
              Как настроить iOS Shortcut (offline-safe, 8 действий)
            </summary>

            <p className="mt-2">
              Один shortcut запускается с Action Button и сразу пишет звук.
              Сохраняем файл в локальную папку <em>до</em> отправки — если интернета
              нет, файл останется на iPhone и его подберёт второй shortcut «Retry voice queue».
            </p>

            <p className="mt-2 font-semibold text-text">Команда «Voice Microtask»</p>
            <ol className="ml-5 mt-2 list-decimal space-y-2">
              <li>
                <b>Команды → ➕ → новая команда</b>, назвать «Voice Microtask».
              </li>
              <li>
                Action <b>«Записать звук»</b>:
                <ul className="ml-4 mt-1 list-disc space-y-0.5 text-muted">
                  <li>Окончание: <code>По нажатию</code> (пользователь нажимает Стоп вручную).</li>
                  <li>Качество: <code>Обычное</code>.</li>
                  <li>Показывать индикатор записи: <code>Вкл</code>.</li>
                </ul>
              </li>
              <li>
                Action <b>«Получить URL»</b> (для генерации идентификатора):
                <ul className="ml-4 mt-1 list-disc space-y-0.5 text-muted">
                  <li>Получить пустую переменную «UUID» через action «UUID» (если есть)
                  или используй <code>Текущая дата</code> в формате ISO как fallback идентификатор.</li>
                </ul>
              </li>
              <li>
                Action <b>«Сохранить файл»</b>:
                <ul className="ml-4 mt-1 list-disc space-y-0.5 text-muted">
                  <li>Файл: переменная «Записанный звук» из шага 2.</li>
                  <li>Путь: <code>На iPhone / Shortcuts / voice-pending / [UUID].m4a</code>.</li>
                  <li>Перезаписывать: <code>Вкл</code>.</li>
                </ul>
              </li>
              <li>
                Action <b>«Получить содержимое URL»</b>:
                <ul className="ml-4 mt-1 list-disc space-y-0.5 text-muted">
                  <li>URL: <code>{voiceWebhookUrl}</code>.</li>
                  <li>Метод: <code>POST</code>.</li>
                  <li>
                    Заголовки: <code>Authorization: Bearer {voiceToken || '<твой-токен>'}</code>.
                  </li>
                  <li>
                    Тело запроса: <code>Form</code> с полями:
                    <ul className="ml-4 list-disc">
                      <li><code>audio</code> = Файл (тип <i>File</i>) → переменная «Записанный звук».</li>
                      <li><code>idempotency_key</code> = Текст → UUID из шага 3.</li>
                    </ul>
                  </li>
                </ul>
              </li>
              <li>
                Action <b>«Если» → Числовое значение «Код состояния» равно 200</b>:
                <ul className="ml-4 mt-1 list-disc space-y-0.5 text-muted">
                  <li>Внутри: action <b>«Удалить файл»</b> → файл из шага 4 (отправили — можно удалять).</li>
                  <li>В блоке «Иначе»: action <b>«Показать уведомление»</b> с текстом
                  «Не отправлено, останется в очереди».</li>
                </ul>
              </li>
              <li>
                Готово. Привязать: <b>Настройки iPhone → Action Button → Команда → Voice Microtask</b>.
              </li>
            </ol>

            <p className="mt-3 font-semibold text-text">Команда «Retry voice queue»</p>
            <ol className="ml-5 mt-2 list-decimal space-y-1.5">
              <li>Action <b>«Получить файлы из папки»</b>: <code>Shortcuts/voice-pending/</code>.</li>
              <li>
                Action <b>«Повторить с каждым»</b> → внутри тела цикла повтори шаги 5-6
                из основного shortcut (POST + удалить при 200).
              </li>
              <li>
                Запускай вручную или через <b>Личная автоматизация</b> при подключении к Wi-Fi.
              </li>
            </ol>

            <p className="mt-3">
              <b>Первый запуск:</b> iOS попросит доступ к микрофону, файлам и сети — одобри.
              Если кнопка Action Button срабатывает на залоченном iPhone — нужно будет
              разблокировать FaceID, чтобы появилась кнопка Стоп записи.
            </p>
          </details>
        </section>
      </div>
    </div>
  );
}
