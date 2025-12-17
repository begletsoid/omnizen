import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { LayoutItem } from '../../features/layout/types';
import { DraggableWidget } from '../DashboardShell';

vi.mock('@dnd-kit/core', () => ({
  useDraggable: () => ({
    setNodeRef: vi.fn(),
    attributes: {},
    listeners: {},
    setActivatorNodeRef: vi.fn(),
    transform: null,
    isDragging: false,
  }),
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: () => 'translate3d(0,0,0)',
    },
  },
}));

describe('DraggableWidget', () => {
  const item = {
    widget_id: 'widget-1',
    type: 'habits',
    x: 0,
    y: 0,
    w: 4,
    h: 3,
    z: 1,
  } as LayoutItem;

  it('рендерится без ошибок при наличии children', () => {
    expect(() =>
      render(
        <DraggableWidget
          item={item}
          title="Test"
          dragDisabled={false}
          columnStep={200}
          rowStep={200}
        >
          <div>content</div>
        </DraggableWidget>,
      ),
    ).not.toThrow();
  });
});

