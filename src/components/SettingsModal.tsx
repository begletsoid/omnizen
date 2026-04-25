import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  useEnsureSleepToken,
  useProfile,
  useRotateSleepToken,
} from '../features/profile/hooks';

type SettingsModalProps = {
  userId: string | null;
  onClose: () => void;
};

export function SettingsModal({ userId, onClose }: SettingsModalProps) {
  const { data: profile } = useProfile(userId);
  const ensureToken = useEnsureSleepToken(userId);
  const rotateToken = useRotateSleepToken(userId);
  const [copied, setCopied] = useState<'url' | 'token' | null>(null);
  const [showToken, setShowToken] = useState(false);

  // Make sure a token exists the moment the modal opens — users who never
  // rotated just see it populated automatically.
  useEffect(() => {
    if (!userId) return;
    if (profile && !profile.sleep_webhook_token && !ensureToken.isPending) {
      ensureToken.mutate();
    }
  }, [userId, profile, ensureToken]);

  const webhookUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/api/sleep-webhook`;
  }, []);
  const token = profile?.sleep_webhook_token ?? '';
  const tz = profile?.timezone ?? 'UTC';
  const lastBedtime = profile?.last_bedtime_at ?? null;

  const copy = useCallback(
    async (kind: 'url' | 'token', value: string) => {
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
          <h3 className="mb-2 text-xs uppercase tracking-widest text-muted">Автоочистка в 04:30</h3>
          <p className="text-xs text-muted">
            Каждое утро в 04:30 по локальному времени сервер автоматически ставит на паузу
            последний запущенный таймер (отсекая время после того, как ты лёг), архивирует все
            задачи с &gt;5 сек на таймере и удаляет пустышки.
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
              Ключевой момент: сам образец сна в Shortcuts показывает только категорию («Core»,
              «Deep» и т.п.). Чтобы достать время, когда ты лёг, нужен второй action —
              «Получить подробные сведения», откуда мы забираем <em>Start Date</em>.
            </p>

            <ol className="ml-5 mt-3 list-decimal space-y-2">
              <li>
                <b>Shortcuts → «Автоматизация» → «+» → «Сон» → «Пробуждение».</b> Нажми
                «Готово» — откроется редактор команды.
              </li>
              <li>
                Добавь action <b>«Найти образцы Здоровья»</b> (Find Health Samples):
                <ul className="ml-4 mt-1 list-disc space-y-0.5 text-muted">
                  <li>Тип: <code>Sleep</code> (Сон).</li>
                  <li>
                    Фильтр (нажми «Добавить фильтр»): <code>Start Date · в течение · Последние 12 часов</code>.
                    Это отсечёт вчерашний дневной сон, оставит только ночь.
                  </li>
                  <li>
                    Сортировка: <code>Start Date</code>, <b>по возрастанию</b> (Ascending).
                    Самый ранний семпл сегодняшней ночи ≈ когда ты лёг.
                  </li>
                  <li>Предел: <code>1</code>.</li>
                </ul>
              </li>
              <li>
                Добавь action <b>«Получить подробные сведения»</b> (Get Details of Health Samples):
                <ul className="ml-4 mt-1 list-disc space-y-0.5 text-muted">
                  <li>Источник: переменная из предыдущего шага (автоподставится).</li>
                  <li>Свойство: <code>Start Date</code> (Дата начала).</li>
                </ul>
                На выходе — ISO-дата типа <code>2026-04-23 01:17:03</code>.
              </li>
              <li>
                Добавь action <b>«Получить содержимое URL»</b>:
                <ul className="ml-4 mt-1 list-disc space-y-0.5 text-muted">
                  <li>URL: тот, что в этом окне выше.</li>
                  <li>Метод: <code>POST</code>.</li>
                  <li>
                    Заголовки: <code>Content-Type: application/json</code> и{' '}
                    <code>Authorization: Bearer {token || '&lt;твой-токен&gt;'}</code>.
                  </li>
                  <li>
                    Тело запроса: <code>Словарь (JSON)</code> с одним ключом <code>bedtime_at</code>,
                    значение — «Детали образцов Здоровья» из шага 3 (просто вставь переменную).
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
      </div>
    </div>
  );
}
