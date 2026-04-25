# Time Transfer Drag — план реализации

Цель: drag за таймер задачи переносит **минуты** из источника в цель. Стандартный row-reorder при этом не активируется.

## UX-сценарий

1. ЛКМ зажата на таймере задачи A. Двигаю мышь.
2. После 6px движения — активируется transfer-mode. Row drag НЕ активируется (stopPropagation).
3. За курсором летит floating preview `5:00` (полупрозрачный, в font-mono).
4. Пока drag идёт, могу набирать цифры на клавиатуре:
   - `5` → preview `5:00`
   - потом `2` → preview `2:00` (заменяется, не добавляется к 5)... нет, **первая цифра заменяет default**, далее накапливается → `5` напечатано когда default=5? пользователь сказал "изначально 5, нажму единичку — заберу одну минуту". Значит первая цифра REPLACE default.
   - `23` → preview `23:00`.
5. На UI самого таймера задачи A показывается **уменьшенное** время в реальном времени (live preview source). Например было `55:21`, дефолт 5 минут → показывается `50:21`. Меняю на 3 минуты → `52:21`.
6. Hover над задачей B → подсветка цели.
7. Отпускаю ЛКМ над B → транзакция: stored у A уменьшается на N сек, у B увеличивается. Floating preview исчезает.
8. Ctrl+Z → reverse transfer. Стек до 20 операций, in-memory (теряется при перезагрузке).

## Поведенческие правила

- Если нажал и отпустил БЕЗ движения 6px → click → стандартное редактирование таймера (как сейчас).
- Если drop вне любой задачи → cancel.
- Если drop на ту же задачу → cancel.
- Escape во время drag → cancel.
- Если introduced > available на source → запрет на уровне RPC (RAISE), на UI не даём отпустить (preview становится `red`, mutation не вызывается).
- Если введено 0 минут → no-op (preview показывается как disabled).
- Source running → таймер продолжает идти, его elapsed корректно уменьшается без визуального скачка.
- Target running → аналогично, elapsed увеличивается без скачка.

## Архитектура

### Слой 1. RPC `transfer_micro_task_time`

Файл: `supabase/migrations/2026XXXXXXXXX_transfer_micro_task_time.sql`

```sql
CREATE OR REPLACE FUNCTION transfer_micro_task_time(
  p_from_task_id uuid,
  p_to_task_id uuid,
  p_seconds integer,
  p_user_id uuid
)
RETURNS jsonb        -- { from_task_id, to_task_id, seconds, applied_at }
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_from micro_tasks%ROWTYPE;
  v_to   micro_tasks%ROWTYPE;
  v_from_total bigint;
  v_now timestamptz := now();
BEGIN
  IF p_seconds IS NULL OR p_seconds <= 0 THEN
    RAISE EXCEPTION 'transfer_seconds_invalid' USING errcode = 'invalid_parameter_value';
  END IF;
  IF p_from_task_id = p_to_task_id THEN
    RAISE EXCEPTION 'transfer_same_task' USING errcode = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_from FROM micro_tasks
   WHERE id = p_from_task_id AND user_id = p_user_id AND archived_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer_source_not_found'; END IF;

  SELECT * INTO v_to FROM micro_tasks
   WHERE id = p_to_task_id AND user_id = p_user_id AND archived_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer_target_not_found'; END IF;

  -- Total time available on source (включая running delta)
  v_from_total := v_from.elapsed_seconds;
  IF v_from.timer_state = 'running' AND v_from.last_started_at IS NOT NULL THEN
    v_from_total := v_from_total + GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_from.last_started_at))::bigint);
  END IF;

  IF v_from_total < p_seconds THEN
    RAISE EXCEPTION 'transfer_insufficient_source_time' USING errcode = 'check_violation';
  END IF;

  -- Source: rebase running interval into stored, then subtract.
  -- (если paused — просто subtract.)
  IF v_from.timer_state = 'running' AND v_from.last_started_at IS NOT NULL THEN
    UPDATE micro_tasks
       SET elapsed_seconds = elapsed_seconds
                              + GREATEST(0, EXTRACT(EPOCH FROM (v_now - last_started_at))::bigint)
                              - p_seconds,
           last_started_at = v_now,
           updated_at = v_now
     WHERE id = p_from_task_id;
  ELSE
    UPDATE micro_tasks
       SET elapsed_seconds = GREATEST(0, elapsed_seconds - p_seconds),
           updated_at = v_now
     WHERE id = p_from_task_id;
  END IF;

  -- Target: rebase running interval, then add.
  IF v_to.timer_state = 'running' AND v_to.last_started_at IS NOT NULL THEN
    UPDATE micro_tasks
       SET elapsed_seconds = elapsed_seconds
                              + GREATEST(0, EXTRACT(EPOCH FROM (v_now - last_started_at))::bigint)
                              + p_seconds,
           last_started_at = v_now,
           updated_at = v_now
     WHERE id = p_to_task_id;
  ELSE
    UPDATE micro_tasks
       SET elapsed_seconds = elapsed_seconds + p_seconds,
           updated_at = v_now
     WHERE id = p_to_task_id;
  END IF;

  RETURN jsonb_build_object(
    'from_task_id', p_from_task_id,
    'to_task_id',   p_to_task_id,
    'seconds',      p_seconds,
    'applied_at',   v_now
  );
END;
$$;

GRANT EXECUTE ON FUNCTION transfer_micro_task_time(uuid, uuid, integer, uuid) TO authenticated;
```

**Важный инвариант** — для `running` задач мы делаем «rebase»: `elapsed_seconds += delta_running` и `last_started_at = now()`. Displayed value (`stored + (now - last_started_at)`) = old_displayed ± p_seconds после применения. Скачок = 0 (continuous).

### Слой 2. Frontend mutation hook

Файл: `src/features/microTasks/api.ts` — добавить `transferMicroTaskTime`.

```ts
export async function transferMicroTaskTime(
  fromTaskId: string,
  toTaskId: string,
  seconds: number,
  userId: string,
): Promise<{ from_task_id: string; to_task_id: string; seconds: number; applied_at: string }> {
  if (!supabase) throw new Error('supabase unavailable');
  const { data, error } = await supabase.rpc('transfer_micro_task_time', {
    p_from_task_id: fromTaskId,
    p_to_task_id:   toTaskId,
    p_seconds:      seconds,
    p_user_id:      userId,
  });
  if (error) throw error;
  return data;
}
```

Файл: `src/features/microTasks/hooks.ts` — `useTransferMicroTaskTime`.

```ts
export function useTransferMicroTaskTime(widgetId: string) {
  const userId = useAuthStore((s) => s.user?.id) ?? null;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ fromTaskId, toTaskId, seconds }: { fromTaskId: string; toTaskId: string; seconds: number }) => {
      if (!userId) throw new Error('unauthorized');
      return transferMicroTaskTime(fromTaskId, toTaskId, seconds, userId);
    },
    onMutate: async ({ fromTaskId, toTaskId, seconds }) => {
      // Optimistic: subtract from source.elapsed_seconds, add to target.elapsed_seconds.
      // Сохраняем previous snapshot для rollback.
      const key = ['microTasks', widgetId];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<MicroTaskRecord[]>(key);
      queryClient.setQueryData<MicroTaskRecord[]>(key, (old) =>
        old?.map((t) => {
          if (t.id === fromTaskId) return { ...t, elapsed_seconds: Math.max(0, t.elapsed_seconds - seconds) };
          if (t.id === toTaskId)   return { ...t, elapsed_seconds: t.elapsed_seconds + seconds };
          return t;
        }),
      );
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(['microTasks', widgetId], ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['microTasks', widgetId] });
    },
  });
}
```

### Слой 3. Утилиты `transferUtils.ts`

Файл: `src/features/microTasks/transferUtils.ts`. Чистые функции, легко тестируются.

```ts
export const TRANSFER_DEFAULT_MINUTES = 5;
export const TRANSFER_KEYBOARD_BUFFER_MAX = 4; // максимум 9999 минут

/** Формат "MM:SS" для preview. Минуты всегда без leading-zero (5:00, 23:00, 100:00). */
export function formatTransferDuration(minutes: number): string {
  const mm = Math.max(0, Math.floor(minutes));
  return `${mm}:00`;
}

/**
 * Из строки с цифрами (от keyboard input) возвращает minutes.
 * Если буфер пуст → default.
 * Если буфер содержит только нули или нечисловое → default.
 */
export function parseKeyboardMinutes(buffer: string, defaultMinutes: number = TRANSFER_DEFAULT_MINUTES): number {
  if (!buffer) return defaultMinutes;
  const n = Number.parseInt(buffer, 10);
  if (Number.isNaN(n) || n < 0) return defaultMinutes;
  return n;
}

/** Применяет цифру (0-9) к буферу. Игнорирует "0" в начале (нет 05). Cap по длине. */
export function appendDigitToBuffer(buffer: string, digit: string): string {
  if (!/^[0-9]$/.test(digit)) return buffer;
  if (buffer === '' && digit === '0') return ''; // leading zero ignored
  if (buffer.length >= TRANSFER_KEYBOARD_BUFFER_MAX) return buffer;
  return buffer + digit;
}

export function backspaceBuffer(buffer: string): string {
  return buffer.slice(0, -1);
}

/** Сколько секунд реально доступно на source (с учётом running delta, в момент now). */
export function computeAvailableSecondsOnSource(
  storedSeconds: number,
  timerState: 'never' | 'paused' | 'running',
  lastStartedAt: string | null,
  now: number = Date.now(),
): number {
  let total = storedSeconds;
  if (timerState === 'running' && lastStartedAt) {
    const startMs = new Date(lastStartedAt).getTime();
    if (Number.isFinite(startMs)) {
      total += Math.max(0, Math.floor((now - startMs) / 1000));
    }
  }
  return Math.max(0, total);
}

/** Эффективные минуты для применения. Не больше доступного на источнике. Не меньше 0. */
export function clampTransferMinutes(requestedMinutes: number, availableSeconds: number): number {
  const requestedSec = Math.max(0, Math.floor(requestedMinutes)) * 60;
  return Math.min(requestedSec, availableSeconds) / 60;
}

export type TransferValidity = 'ok' | 'too_much' | 'zero' | 'no_target' | 'same_task';

export function validateTransfer(
  effectiveMinutes: number,
  availableSeconds: number,
  hoveredTargetId: string | null,
  sourceTaskId: string,
): TransferValidity {
  if (!hoveredTargetId) return 'no_target';
  if (hoveredTargetId === sourceTaskId) return 'same_task';
  if (effectiveMinutes <= 0) return 'zero';
  if (effectiveMinutes * 60 > availableSeconds) return 'too_much';
  return 'ok';
}
```

### Слой 4. State hook `useTimeTransferDrag`

Файл: `src/widgets/microTasks/hooks/useTimeTransferDrag.ts`. Один хук на весь виджет, держит:

```ts
type TransferDragState = {
  sourceTaskId: string;
  pointer: { x: number; y: number };
  pointerStart: { x: number; y: number };
  keyboardBuffer: string;          // "" => use default
  hoveredTargetId: string | null;
  // Snapshot источника на момент старта drag — чтобы preview не дёргался от tick'а:
  sourceCommittedSeconds: number;  // stored elapsed snapshot
  sourceTimerState: TimerState;
  sourceLastStartedAt: string | null;
};

type PreActivation = { sourceTaskId: string; downX: number; downY: number; pointerId: number };
```

API хука:
- `beginPreActivation(taskId, e)` — вызывается из `onPointerDown` на timer button.
- Внутри listener `pointermove` если `distance > ACTIVATION = 6` → переходим в active state.
- Activation: добавляем `keydown` listener.
- `pointerup` без активации → click (не наша забота, родительский handler).
- `pointermove` после активации → обновить pointer + hovered target (через `document.elementFromPoint(x,y).closest('[data-task-id]')`).
- `pointerup` после активации:
  - validate. Если 'ok' → mutate + push undo. Иначе → cancel.
- `Escape` → cancel.
- Returns: `{ state, transferring: bool, effectiveMinutes, validity, registerTimerActivator }`.

Undo stack:
```ts
type TransferOp = { fromTaskId: string; toTaskId: string; seconds: number; appliedAt: number };
```
- Хук поддерживает `useRef<TransferOp[]>([])`.
- При успешной mutation — push.
- Window keydown `Ctrl+Z` или `Cmd+Z` → если стек не пустой и не открыт инпут (focus check) → reverse mutation: `transfer(to, from, seconds)`. Pop из стека.
- Стек ограничен 20 операциями.
- При ошибке reverse mutation — re-push в стек.

### Слой 5. UI integration

**`MicroTaskCard.tsx`** — изменения только в timer button и его пропсы:
```tsx
<button
  type="button"
  data-time-transfer-source={task.id}
  onPointerDown={(e) => onTimerPointerDown(task.id, e)}
  onClick={(e) => {
    if (transferDragActiveRef.current) return; // активация подавила click
    void onTimeClick();
  }}
  className={clsx(
    'w-24 text-center font-mono text-base text-text tabular-nums transition hover:text-white/80',
    isTransferSource && 'text-amber-200',     // source visual cue
    isTransferTarget && 'ring-2 ring-emerald-400/60 rounded-lg', // target hover
  )}
>
  {timeLabelOverride ?? timeLabel}
</button>
```

**Прокси**: родитель (MicroTasksWidget) вычисляет `timeLabelOverride` для source-карточки = `formatDuration(committedSeconds - effectiveMinutes*60 + (running ? delta : 0))`. Для running source мы пересчитываем каждую секунду через `now` state. (Пользователь конкретно просил, чтобы во время drag тики продолжали идти.)

**Stop propagation на pointerdown** — в существующем row-pointer-DnD `usePointerDnd.ts` нужно добавить guard:
```ts
if ((e.target as HTMLElement).closest('[data-time-transfer-source]')) return;
```
ИЛИ stop propagation в timer's onPointerDown. Чище — guard в существующем коде, чтобы поведение было видно в одном месте.

**`MicroTasksWidget.tsx`**:
- Подключает `useTimeTransferDrag`.
- Прокидывает `onTimerPointerDown`, `transferDragState`, `effectiveMinutes`, `validity`, `committedSourceSeconds` детям.
- Рендерит `<TimeTransferOverlay />` через `FloatingPortal`.

**Новый компонент**: `src/widgets/microTasks/components/TimeTransferOverlay.tsx`
```tsx
export function TimeTransferOverlay({ x, y, minutes, validity }: Props) {
  return (
    <FloatingPortal>
      <div
        style={{
          position: 'fixed',
          left: x + 12,
          top:  y - 18,
          pointerEvents: 'none',
          zIndex: 1500,
        }}
        className={clsx(
          'rounded-xl border bg-background/85 px-3 py-1.5 font-mono text-base shadow-2xl backdrop-blur',
          validity === 'ok'        && 'border-emerald-400/60 text-emerald-100',
          validity === 'too_much'  && 'border-rose-400/70 text-rose-100',
          validity === 'zero'      && 'border-white/30 text-muted opacity-50',
          validity === 'no_target' && 'border-white/30 text-text opacity-70',
          validity === 'same_task' && 'border-white/30 text-muted opacity-50',
        )}
      >
        {formatTransferDuration(minutes)}
      </div>
    </FloatingPortal>
  );
}
```

## Тестовый план

### Unit (vitest, чистые функции) — `src/features/microTasks/__tests__/transferUtils.test.ts`

- `formatTransferDuration`: 0, 1, 5, 60, 100, 999.
- `parseKeyboardMinutes`: пустая, "0", "5", "23", "100", "abc".
- `appendDigitToBuffer`:
  - "" + "5" = "5"
  - "" + "0" = "" (leading zero ignored)
  - "5" + "0" = "50"
  - "5" + "x" = "5"
  - "9999" + "1" = "9999" (cap 4 chars)
- `backspaceBuffer`: "23" → "2", "" → "".
- `computeAvailableSecondsOnSource`:
  - paused, stored=300 → 300.
  - running, stored=300, last_started 60s ago → 360.
  - running без last_started → 300 (graceful).
  - now < last_started (clock skew) → 300 (no negative).
- `clampTransferMinutes`:
  - 5 min, 600s available → 5.
  - 5 min, 240s available → 4.
  - 0 min → 0.
  - -3 min → 0.
- `validateTransfer`: все 5 случаев.

### Hook test — `src/widgets/microTasks/hooks/__tests__/useTimeTransferDrag.test.tsx`

- pre-activation → click без drag вызывает `onClick` родителя.
- pre-activation + move > 6px → activation.
- keydown "5" во время drag → effectiveMinutes = 5.
- keydown "1" → effectiveMinutes = 1 (replace default).
- keydown "1" "2" "3" → 123.
- backspace → корректно.
- Escape → cancel.
- pointerup на target → mutate called с правильными аргументами.
- pointerup без target → no mutation.
- pointerup на source → no mutation.
- Ctrl+Z после успешного transfer → reverse mutation.

### RPC smoke — добавить в `scripts/smoke.ts`

`runTimeTransferSmoke()`:
1. Создать widget + 2 paused задачи: A (300s), B (0s).
2. RPC transfer A → B, 60s. Проверить A=240, B=60.
3. Старт таймера A, подождать 2s, RPC transfer A → B, 30s.
   - А продолжает running, B paused.
   - elapsed_seconds на A примерно = 240 + 2 - 30 = 212.
   - last_started_at у A обновлён.
4. Старт таймера на B. RPC transfer A → B, 60s.
   - оба running, оба rebased.
5. Negative tests: RPC transfer 0 → expect error. transfer same task → error. transfer > available → error.

### Integration — `src/widgets/microTasks/__tests__/MicroTasksWidget.test.tsx`

- 2 задачи, mock supabase RPC для `transfer_micro_task_time`.
- userEvent.pointer для симуляции drag из TaskA таймер на TaskB карточку.
- Проверить overlay появился, потом исчез.
- После drop → mock RPC получил правильные args.
- Симулировать keydown цифр во время drag → effectiveMinutes меняется.
- Симулировать Ctrl+Z после drop → reverse RPC получил args.

## Edge cases (отдельный чеклист в тестах)

| # | Случай | Тест |
|---|---|---|
| 1 | Click без drag | Hook: pre-act → click пропускается родителю |
| 2 | Drag менее 6px | Hook: stays in pre-activation, no overlay |
| 3 | Source running source | RPC smoke + util test |
| 4 | Target running | RPC smoke |
| 5 | Both running | RPC smoke |
| 6 | Transfer > available | RPC smoke (RAISE), util test (validity='too_much') |
| 7 | Transfer 0 | RPC smoke (RAISE), util test (validity='zero') |
| 8 | Transfer same task | RPC smoke (RAISE), util test (validity='same_task') |
| 9 | Drop вне задач | Hook test: no mutation |
| 10 | Drop на archived | RPC smoke: NOT FOUND |
| 11 | Keyboard "100" | Hook test |
| 12 | Backspace до пустого | Util + hook test |
| 13 | Escape во время drag | Hook test: cancel |
| 14 | Ctrl+Z с пустым стеком | Hook test: noop |
| 15 | Ctrl+Z после 2 transfer | Hook test: undo последний; ещё раз → undo предыдущий |
| 16 | Ошибка mutation | Optimistic rollback — integration test |

## Реализация (порядок)

1. ✅ Branch `time-transfer-drag` от master.
2. Migration + RPC + smoke test.
3. `transferUtils.ts` + unit tests.
4. `transferMicroTaskTime` API + hook + optimistic.
5. `useTimeTransferDrag` hook + tests.
6. `TimeTransferOverlay` компонент.
7. Интеграция в `MicroTaskCard` и `MicroTasksWidget`.
8. Stop-propagation guard в `usePointerDnd` (или sibling).
9. Undo stack + Ctrl+Z global listener.
10. Integration test.
11. Typecheck + tests + lint + smoke + build.
