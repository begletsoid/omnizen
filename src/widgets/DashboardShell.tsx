import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { DragEndEvent } from '@dnd-kit/core';
import { DndContext, PointerSensor, useDraggable, useSensor, useSensors } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { AuthButton } from '../components/AuthButton';
import { useBootstrapDashboard } from '../features/dashboards/hooks';
import type { WidgetRecord } from '../features/dashboards/types';
import { updateWidgetConfig } from '../features/dashboards/api';
import type { LayoutItem } from '../features/layout/types';
import { useDashboardLayout } from '../features/layout/hooks';
import {
  clampGridPosition,
  DEFAULT_ROW_HEIGHT_PX,
  GRID_COLUMNS,
  GRID_GAP_PX,
} from '../features/layout/utils';
import { useAuthStore } from '../stores/authStore';
import { AnalyticsWidget } from './analytics/AnalyticsWidget';
import { HabitsWidget } from './habits/HabitsWidget';
import { MicroTasksWidget } from './microTasks/MicroTasksWidget';

import { WidgetPlaceholder } from './WidgetPlaceholder';
import type { WidgetPlaceholderProps } from './WidgetPlaceholder';

const MIN_COL_WIDTH = 80;

const widgetMeta: Record<
  LayoutItem['type'],
  WidgetPlaceholderProps & { title: string; description: string }
> = {
  habits: {
    title: 'Лента привычек',
    description: 'Управляйте статусами привычек и перетаскивайте карточки между колонками.',
    accent: 'green',
  },
  problems: {
    title: 'Проблемы / Решения',
    description: 'Таблица проблем и альтернативных решений с редактированием по месту.',
    accent: 'amber',
  },
  tasks: {
    title: 'Микрозадачи',
    description: 'Быстрый todo-лист с чекбоксами и сортировкой мышью.',
    accent: 'cyan',
  },
  analytics: {
    title: 'Аналитика',
    description: 'Отчёты по завершённым задачам, таймеры и графики.',
    accent: 'cyan',
  },
  image: {
    title: 'Виджет-картинка',
    description: 'Загрузка изображений, перемещение и изменение размеров.',
    accent: 'pink',
  },
};

export function DashboardShell() {
  const user = useAuthStore((state) => state.user);
  const userId = user?.id ?? null;
  const {
    data: bootstrap,
    isLoading: isDashboardLoading,
    isError,
    error,
  } = useBootstrapDashboard(userId);
  const dashboardId = bootstrap?.dashboard.id ?? null;
  const { data: layoutRecord, saveLayout, isSaving } = useDashboardLayout(dashboardId);
  const [localLayout, setLocalLayout] = useState<LayoutItem[]>([]);
  const layoutFromBootstrap = bootstrap?.layout.layout ?? [];
  const remoteLayout = layoutRecord?.layout ?? layoutFromBootstrap;
  const layoutSignature = useMemo(
    () => remoteLayout.map((item) => item.widget_id).join('|'),
    [remoteLayout],
  );

  useEffect(() => {
    if (!remoteLayout.length) return;
    setLocalLayout(remoteLayout.map((item) => ({ ...item })));
  }, [layoutSignature, remoteLayout]);

  const layoutItems = localLayout.length ? localLayout : remoteLayout;
  const widgetsById = useMemo(() => {
    const map = new Map<string, WidgetRecord>();
    bootstrap?.widgets.forEach((widget) => map.set(widget.id, widget));
    return map;
  }, [bootstrap?.widgets]);
  const queryClient = useQueryClient();
  const { mutate: persistWidgetConfig } = useMutation({
    mutationFn: ({
      widgetId,
      config,
    }: {
      widgetId: string;
      config: Record<string, unknown>;
    }) => updateWidgetConfig(widgetId, config),
  });

  const handleWidgetConfigPatch = useCallback(
    (widget: WidgetRecord | undefined, patch: Record<string, unknown>) => {
      if (!widget || !userId || !dashboardId) return;
      const widgetId = widget.id;
      const nextConfig = { ...(widget.config ?? {}), ...patch };
      const optimistic: WidgetRecord = { ...widget, config: nextConfig };

      queryClient.setQueryData(['dashboard', userId], (prev: typeof bootstrap | undefined) => {
        if (!prev) return prev;
        return {
          ...prev,
          widgets: prev.widgets.map((entry) => (entry.id === widgetId ? optimistic : entry)),
        };
      });

      queryClient.setQueryData(['widgets', dashboardId], (prev?: WidgetRecord[]) => {
        if (!prev) return prev;
        return prev.map((entry) => (entry.id === widgetId ? optimistic : entry));
      });

      persistWidgetConfig(
        { widgetId, config: nextConfig },
        {
          onError: () => {
            queryClient.invalidateQueries({ queryKey: ['dashboard', userId] });
            queryClient.invalidateQueries({ queryKey: ['widgets', dashboardId] });
          },
        },
      );
    },
    [dashboardId, persistWidgetConfig, queryClient, userId],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 12 },
    }),
  );
  const canDrag = Boolean(userId && dashboardId);
  const boardRef = useRef<HTMLDivElement>(null);
  const [columnWidth, setColumnWidth] = useState<number>(120);

  useEffect(() => {
    if (!boardRef.current) return;
    const element = boardRef.current;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      const available =
        width - GRID_GAP_PX * Math.max(0, Math.min(GRID_COLUMNS - 1, GRID_COLUMNS - 1));
      const nextWidth =
        GRID_COLUMNS > 0 ? Math.max(MIN_COL_WIDTH, available / GRID_COLUMNS) : MIN_COL_WIDTH;
      setColumnWidth(nextWidth);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const columnStep = columnWidth + GRID_GAP_PX;
  const rowStep = DEFAULT_ROW_HEIGHT_PX + GRID_GAP_PX;

  const handleDragEnd = (event: DragEndEvent) => {
    if (!canDrag) return;
    const { active, delta } = event;
    setLocalLayout((current) => {
      const index = current.findIndex((item) => item.widget_id === active.id);
      if (index === -1) return current;
      const item = current[index];
      const baseX = (item.x ?? 0) * columnStep;
      const baseY = (item.y ?? 0) * rowStep;
      const candidate = {
        x: (baseX + delta.x) / columnStep,
        y: (baseY + delta.y) / rowStep,
      };
      const clampedSubgrid = clampGridPosition(candidate, item);
      const clamped = clampedSubgrid;
      const nextZ = Math.max(...current.map((entry) => entry.z ?? 0), 0) + 1;
      const updated = current.map((entry, idx) =>
        idx === index ? { ...entry, ...clamped, z: nextZ } : entry,
      );
      saveLayout(updated);
      return updated;
    });
  };

  const userLabel =
    user?.user_metadata?.full_name ?? user?.email ?? (user ? `id: ${user.id}` : 'Гость');
  const layoutReady = Boolean(layoutItems.length);

  return (
    <div className="min-h-screen bg-background text-text">
      <header className="flex flex-col gap-5 px-6 pb-8 pt-10 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.3rem] text-muted">omnizen</p>
          <h1 className="text-3xl font-semibold">
            {bootstrap?.dashboard.title ?? 'Персональный дашборд'}
          </h1>
          <p className="text-sm text-muted">
            Вход через Google, данные хранятся в Supabase. Дальше здесь появится drag-and-drop сетка
            с живыми виджетами.
          </p>
          {isDashboardLoading && user ? (
            <p className="text-xs text-muted">Загружаем ваши виджеты…</p>
          ) : null}
          {isError ? (
            <p className="text-xs text-red-400">
              Не удалось загрузить дашборд: {error?.message ?? 'неизвестная ошибка'}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-start gap-4 text-sm text-muted sm:items-end">
          <div className="flex gap-4">
            <div className="text-left sm:text-right">
              <p className="font-semibold text-text">Netlify</p>
              <p>CI / CD готов</p>
            </div>
            <div className="text-left sm:text-right">
              <p className="font-semibold text-text">Supabase</p>
              <p>Schema snapshot подтянут</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-left text-xs uppercase tracking-widest text-muted sm:text-right">
              <p className="text-[0.65rem]">Пользователь</p>
              <p className="text-base font-semibold normal-case tracking-normal text-text">
                {userLabel}
              </p>
            </div>
            <AuthButton />
          </div>
          {canDrag && (
            <p className="text-xs text-muted">
              Перетаскивание виджетов {isSaving ? '— сохраняем изменения…' : 'доступно'}
            </p>
          )}
        </div>
      </header>

      <main className="px-6 pb-16">
        {!layoutReady && (
          <section className="glass-panel border border-border/50 bg-surface/60 px-6 py-10 text-center text-sm text-muted">
            {isDashboardLoading ? 'Загружаем виджеты...' : 'Виджеты ещё не готовы.'}
          </section>
        )}
        {layoutReady && (
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <div ref={boardRef} className="relative min-h-[30rem]">
              {layoutItems.map((item) => {
                const widget = widgetsById.get(item.widget_id);
                const meta = widgetMeta[item.type];
                const title =
                  (widget?.config?.title as string | undefined) ?? meta?.title ?? 'Виджет';
                const storedHeight =
                  typeof widget?.config?.habitListHeight === 'number'
                    ? (widget.config.habitListHeight as number)
                    : undefined;
                const storedScrollTop =
                  typeof widget?.config?.habitScrollTop === 'number'
                    ? (widget.config.habitScrollTop as number)
                    : undefined;
                let content: ReactNode;
                if (item.type === 'habits') {
                  content = (
                    <HabitsWidget
                      widgetId={item.widget_id}
                      initialHeight={storedHeight}
                      initialScrollTop={storedScrollTop}
                      onHeightChange={(nextHeight) =>
                        handleWidgetConfigPatch(widget, { habitListHeight: nextHeight })
                      }
                      onScrollPersist={(scrollTop) =>
                        handleWidgetConfigPatch(widget, { habitScrollTop: scrollTop })
                      }
                    />
                  );
                } else if (item.type === 'tasks') {
                  content = (
                    <MicroTasksWidget
                      widgetId={item.widget_id}
                      config={widget?.config ?? null}
                      onUpdateConfig={
                        widget ? (patch) => handleWidgetConfigPatch(widget, patch) : undefined
                      }
                    />
                  );
                } else if (item.type === 'analytics') {
                  content = <AnalyticsWidget widgetId={item.widget_id} />;
                } else {
                  content = (
                    <div className="h-full">
                      <WidgetPlaceholder {...widgetMeta[item.type]} />
                    </div>
                  );
                }
                return (
                  <DraggableWidget
                    key={item.widget_id}
                    item={item}
                    title={title}
                    dragDisabled={!canDrag}
                    columnStep={columnStep}
                    rowStep={rowStep}
                  >
                    {content}
                  </DraggableWidget>
                );
              })}
            </div>
            {!canDrag && (
              <p className="mt-4 text-center text-xs text-muted">
                Войдите через Google, чтобы переставлять виджеты.
              </p>
            )}
          </DndContext>
        )}
      </main>
    </div>
  );
}

type SortableWidgetProps = {
  item: LayoutItem;
  title: string;
  dragDisabled: boolean;
  children: ReactNode;
  columnStep: number;
  rowStep: number;
};

function DraggableWidget({
  item,
  title,
  dragDisabled,
  children,
  columnStep,
  rowStep,
}: SortableWidgetProps) {
  const {
    setNodeRef,
    attributes,
    listeners,
    setActivatorNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: item.widget_id,
    disabled: dragDisabled,
  });

  const baseX = (item.x ?? 0) * columnStep;
  const baseY = (item.y ?? 0) * rowStep;
  const translateX = baseX + (transform?.x ?? 0);
  const translateY = baseY + (transform?.y ?? 0);
  const style: CSSProperties = {
    transform: CSS.Transform.toString({
      x: translateX,
      y: translateY,
      scaleX: 1,
      scaleY: 1,
    }),
    zIndex: isDragging ? 100 : (item.z ?? 1),
  };

  return (
    <article
      aria-label={title}
      ref={setNodeRef}
      style={style}
      className="absolute flex select-none flex-col rounded-3xl bg-surface/90 p-4 shadow-card backdrop-blur transition-shadow"
    >
      <div className="flex items-center justify-end">
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-sm text-muted ring-1 ring-white/20 transition hover:text-text disabled:opacity-50"
          aria-label="Переместить виджет"
          disabled={dragDisabled}
          {...listeners}
          {...attributes}
        >
          ⇅
        </button>
      </div>
      <div className="mt-4">{children}</div>
    </article>
  );
}

export { DraggableWidget };
