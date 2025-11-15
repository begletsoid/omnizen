import type { User } from '@supabase/supabase-js';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardShell } from '../DashboardShell';
import { useAuthStore } from '../../stores/authStore';

vi.mock('../../lib/supabaseClient', () => ({ supabase: undefined }));
vi.mock('../../features/dashboards/hooks', () => ({
  useBootstrapDashboard: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

describe('DashboardShell', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, session: null });
  });

  it('показывает кнопку входа, если пользователь не авторизован', () => {
    render(<DashboardShell />);

    expect(screen.getByRole('button', { name: /войти через google/i })).toBeInTheDocument();
  });

  it('показывает кнопку выхода, если пользователь авторизован', () => {
    useAuthStore.setState({
      user: mockUser(),
      session: null,
    });

    render(<DashboardShell />);

    expect(screen.getByRole('button', { name: /выйти/i })).toBeInTheDocument();
    expect(screen.getByText(/demo@example.com/i)).toBeInTheDocument();
  });
});

function mockUser(): User {
  return {
    id: 'user-1',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'demo@example.com',
    app_metadata: {},
    user_metadata: {},
    identities: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    factors: [],
  };
}
