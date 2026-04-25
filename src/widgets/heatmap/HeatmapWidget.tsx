import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
} from '@floating-ui/react';
import clsx from 'clsx';

import { useHeatmapDayDetails, useHeatmapPeriodStats } from '../../features/heatmap/hooks';
import {
  computeHeatmapMetrics,
  computeIntensityBucket,
  enumerateDays,
  formatHoursTenth,
  formatSeconds,
  parseDayKey,
  toDayKey,
} from '../../features/heatmap/utils';
import type { HeatmapDayStats, HeatmapMode } from '../../features/heatmap/types';

type HeatmapWidgetProps = {
  widgetId: string | null;
  config?: Record<string, unknown> | null;
  onUpdateConfig?: (patch: Record<string, unknown>) => void;
};

// 10-step scales (indexed 0..9). Bucket 0 is "empty", 1..9 ramp smoothly by opacity
// on a single hue, so the gradient reads as one continuous intensity dimension.
const CELL_COLORS: Record<HeatmapMode, readonly string[]> = {
  value: [
    'bg-white/5',
    'bg-emerald-500/15',
    'bg-emerald-500/25',
    'bg-emerald-500/35',
    'bg-emerald-500/45',
    'bg-emerald-500/55',
    'bg-emerald-500/65',
    'bg-emerald-500/75',
    'bg-emerald-500/90',
    'bg-emerald-400',
  ],
  time: [
    'bg-white/5',
    'bg-amber-500/15',
    'bg-amber-500/25',
    'bg-amber-500/35',
    'bg-amber-500/45',
    'bg-amber-500/55',
    'bg-amber-500/65',
    'bg-amber-500/75',
    'bg-amber-500/90',
    'bg-amber-400',
  ],
};

const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function getDefaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return toDayKey(d);
}

function readMode(config: Record<string, unknown> | null | undefined): HeatmapMode {
  const raw = config?.heatmapMode;
  return raw === 'time' ? 'time' : 'value';
}

function readFrom(config: Record<string, unknown> | null | undefined): string {
  const raw = config?.heatmapFrom;
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return getDefaultFrom();
}

function formatHumanDate(day: string): string {
  return parseDayKey(day).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function HeatmapWidget({ config, onUpdateConfig }: HeatmapWidgetProps) {
  const from = readFrom(config);
  const mode = readMode(config);
  const today = toDayKey(new Date());

  const { data: stats = [], isLoading, isError } = useHeatmapPeriodStats(from, today);

  const statsByDay = useMemo(() => {
    const m = new Map<string, HeatmapDayStats>();
    for (const s of stats) m.set(s.day, s);
    return m;
  }, [stats]);

  const days = useMemo(() => enumerateDays(from, today), [from, today]);
  const metrics = useMemo(() => computeHeatmapMetrics(days, statsByDay), [days, statsByDay]);

  const max = useMemo(() => {
    if (stats.length === 0) return 0;
    let m = 0;
    for (const s of stats) {
      const v = mode === 'value' ? s.points : s.seconds;
      if (v > m) m = v;
    }
    return m;
  }, [stats, mode]);

  const columns = useMemo(() => {
    if (days.length === 0) return [] as string[][];
    const weekdayISO = (d: Date) => (d.getDay() + 6) % 7; // 0=Mon..6=Sun
    const result: string[][] = [];
    const firstDay = parseDayKey(days[0]);
    let column: string[] = Array(weekdayISO(firstDay)).fill('');
    for (const day of days) {
      column.push(day);
      if (column.length === 7) {
        result.push(column);
        column = [];
      }
    }
    if (column.length > 0) {
      while (column.length < 7) column.push('');
      result.push(column);
    }
    return result;
  }, [days]);

  // ---- Floating tooltip (escapes widget and dashboard clipping) ----
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [referenceEl, setReferenceEl] = useState<HTMLElement | null>(null);
  const { refs, floatingStyles, context } = useFloating({
    open: Boolean(openDay),
    onOpenChange: (open) => { if (!open) setOpenDay(null); },
    placement: 'top',
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
    elements: { reference: referenceEl },
  });
  const dismiss = useDismiss(context);
  const { getFloatingProps } = useInteractions([dismiss]);

  const { data: dayDetails = [] } = useHeatmapDayDetails(openDay);
  const sortedDetails = useMemo(
    () => [...dayDetails].sort((a, b) => b.points_today - a.points_today || b.seconds_today - a.seconds_today),
    [dayDetails],
  );
  const selectedStat = openDay ? statsByDay.get(openDay) : undefined;
  const totalDayPoints = selectedStat?.points ?? 0;
  const totalDaySeconds = selectedStat?.seconds ?? 0;
  const dayAvgPerHour = totalDaySeconds > 0 ? (totalDayPoints * 3600) / totalDaySeconds : 0;

  const handleCellClick = useCallback((day: string, el: HTMLElement) => {
    if (openDay === day) {
      setOpenDay(null);
      return;
    }
    setReferenceEl(el);
    setOpenDay(day);
  }, [openDay]);

  const handleDateChange = useCallback((value: string) => {
    if (!value) return;
    onUpdateConfig?.({ heatmapFrom: value });
  }, [onUpdateConfig]);

  const handleModeChange = useCallback((m: HeatmapMode) => {
    onUpdateConfig?.({ heatmapMode: m });
  }, [onUpdateConfig]);

  // Measure the intrinsic width of the heatmap content (weekday column + cells)
  // so the metrics footer wraps to match — few cells → narrow footer → metrics
  // wrap to multiple rows naturally. Many cells → wider footer → fewer rows.
  const heatmapContentRef = useRef<HTMLDivElement>(null);
  const [metricsMaxWidth, setMetricsMaxWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = heatmapContentRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      // offsetWidth reflects the intrinsic layout width (flex-item, no grow/shrink)
      // even when the parent has overflow:auto and the content fits without scroll.
      setMetricsMaxWidth(entry.target instanceof HTMLElement ? entry.target.offsetWidth : null);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [days.length]);

  return (
    <section className="flex flex-col gap-3 rounded-[2.5rem] border border-white/10 bg-background/40 px-4 py-4">
      <header className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-muted">
          С
          <input
            type="date"
            value={from}
            max={today}
            onChange={(e) => handleDateChange(e.target.value)}
            className="rounded bg-white/5 px-2 py-1 text-xs text-text outline-none"
          />
        </label>
        <div className="ml-auto flex items-center gap-0.5 rounded-full border border-white/10 p-0.5">
          <button
            type="button"
            onClick={() => handleModeChange('value')}
            className={clsx(
              'rounded-full px-2.5 py-0.5 text-sm transition',
              mode === 'value' ? 'bg-emerald-500/20 text-emerald-200' : 'text-muted hover:text-text',
            )}
            aria-label="Режим: ценность"
            aria-pressed={mode === 'value'}
          >
            💰
          </button>
          <button
            type="button"
            onClick={() => handleModeChange('time')}
            className={clsx(
              'rounded-full px-2.5 py-0.5 text-sm transition',
              mode === 'time' ? 'bg-amber-500/20 text-amber-200' : 'text-muted hover:text-text',
            )}
            aria-label="Режим: время"
            aria-pressed={mode === 'time'}
          >
            🕐
          </button>
        </div>
      </header>

      {isLoading && <p className="text-xs text-muted">Загружаем хитмапу...</p>}
      {isError && <p className="text-xs text-rose-400">Не удалось загрузить данные</p>}

      <div className="flex overflow-x-auto">
        <div ref={heatmapContentRef} className="flex shrink-0 gap-2">
        <div className="flex flex-col gap-1 pt-0.5 text-[0.6rem] text-muted">
          {WEEKDAY_LABELS.map((label, idx) => (
            <div key={idx} className="flex h-3 items-center leading-none">
              {idx % 2 === 1 ? label : ''}
            </div>
          ))}
        </div>
        <div className="flex gap-1">
          {columns.map((week, wIdx) => (
            <div key={wIdx} className="flex flex-col gap-1">
              {week.map((day, dIdx) => {
                if (!day) {
                  return <div key={dIdx} className="h-3 w-3" aria-hidden />;
                }
                const stat = statsByDay.get(day);
                const value = stat ? (mode === 'value' ? stat.points : stat.seconds) : 0;
                const bucket = computeIntensityBucket(value, max);
                const active = openDay === day;
                const aria = mode === 'value'
                  ? `${day}: ${stat?.points ?? 0} очков`
                  : `${day}: ${formatSeconds(stat?.seconds ?? 0)}`;
                return (
                  <button
                    key={dIdx}
                    type="button"
                    onClick={(e) => handleCellClick(day, e.currentTarget)}
                    className={clsx(
                      'h-3 w-3 rounded-[3px] transition focus:outline-none',
                      CELL_COLORS[mode][bucket],
                      active && 'ring-1 ring-white',
                    )}
                    aria-label={aria}
                    aria-pressed={active}
                  />
                );
              })}
            </div>
          ))}
        </div>
        </div>
      </div>

      {/* Metrics footer.
          Outer flex-wrap contains 3 logical "atoms":
          (1) max streak + active% sub-flex (flex-nowrap → always stay together)
          (2) current streak
          (3) averages block
          Browser wraps atoms based on current width:
            - wide  → all in 1 row
            - mid   → (max+active+current) in 1 row, averages on 2nd
            - narrow → (max+active) row 1, current row 2, averages row 3. */}
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted"
        style={metricsMaxWidth ? { maxWidth: metricsMaxWidth } : undefined}
      >
        <div className="flex flex-nowrap items-center gap-x-4">
          <span className="whitespace-nowrap">
            макс. стрик: <span className="text-text">{metrics.longestStreak}</span>
          </span>
          <span className="whitespace-nowrap">
            активных: <span className="text-text">{metrics.activePercent.toFixed(0)}%</span>
          </span>
        </div>
        <span className="whitespace-nowrap">
          текущий стрик: <span className="text-text">{metrics.currentStreak}</span>
        </span>
        <span className="whitespace-nowrap tabular-nums">
          💰 <span className="text-text">{Math.round(metrics.avgPointsPerDay)}</span>
          <span className="mx-1">/</span>
          🕐 <span className="text-text">{formatHoursTenth(metrics.avgSecondsPerDay)}</span>
          <span className="mx-1">=</span>
          <span className="text-text">{Math.round(metrics.avgPointsPerHour)}/ч</span>
        </span>
      </div>

      {/* Tooltip — rendered in body via portal, sits above everything. */}
      {openDay && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-[9999] w-80 max-w-[calc(100vw-1rem)] rounded-2xl border border-white/10 bg-background/95 p-4 text-xs text-text shadow-2xl backdrop-blur"
          >
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <span className="font-semibold">{formatHumanDate(openDay)}</span>
              <span className="tabular-nums text-muted">
                💰 <span className="font-semibold text-text">{totalDayPoints}</span>
                <span className="mx-1.5">/</span>
                🕐 <span className="font-semibold text-text">{formatSeconds(totalDaySeconds)}</span>
                {totalDaySeconds > 0 && (
                  <>
                    <span className="mx-1.5">=</span>
                    <span className="font-semibold text-text">{Math.round(dayAvgPerHour)}/ч</span>
                  </>
                )}
              </span>
            </div>
            {sortedDetails.length === 0 ? (
              <p className="text-muted">Нет активности по целям</p>
            ) : (
              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 gap-y-1 items-baseline">
                {sortedDetails.map((d) => (
                  <Fragment key={d.goal_id}>
                    <span className="min-w-0 truncate">{d.title}</span>
                    <span className="whitespace-nowrap tabular-nums text-right">
                      💰 {d.points_today}
                      <span className="text-muted"> / {d.value}</span>
                    </span>
                    <span className="whitespace-nowrap tabular-nums text-right">
                      🕐 {formatSeconds(d.seconds_today)}
                      <span className="text-muted"> / {formatSeconds(d.seconds_total)}</span>
                    </span>
                  </Fragment>
                ))}
              </div>
            )}
          </div>
        </FloatingPortal>
      )}
    </section>
  );
}
