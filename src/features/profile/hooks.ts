import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { supabase } from '../../lib/supabaseClient';
import {
  ensureSleepWebhookToken,
  ensureVoiceWebhookToken,
  fetchProfile,
  rotateSleepWebhookToken,
  rotateVoiceWebhookToken,
  updateProfileTimezone,
  updateVoiceTargetWidget,
  type ProfileRecord,
} from './api';

const PROFILE_KEY = (userId: string | null) => ['profile', userId] as const;

export function useProfile(userId: string | null) {
  return useQuery<ProfileRecord | null, Error>({
    queryKey: PROFILE_KEY(userId),
    queryFn: async () => (userId ? fetchProfile(userId) : null),
    enabled: Boolean(userId && supabase),
    staleTime: 60_000,
  });
}

export function useRotateSleepToken(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('Not signed in');
      return rotateSleepWebhookToken(userId);
    },
    onSuccess: (token) => {
      queryClient.setQueryData<ProfileRecord | null>(PROFILE_KEY(userId), (prev) =>
        prev ? { ...prev, sleep_webhook_token: token } : prev,
      );
    },
  });
}

export function useEnsureSleepToken(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('Not signed in');
      return ensureSleepWebhookToken(userId);
    },
    onSuccess: (token) => {
      queryClient.setQueryData<ProfileRecord | null>(PROFILE_KEY(userId), (prev) =>
        prev ? { ...prev, sleep_webhook_token: token } : prev,
      );
    },
  });
}

export function useEnsureVoiceToken(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('Not signed in');
      return ensureVoiceWebhookToken(userId);
    },
    onSuccess: (token) => {
      queryClient.setQueryData<ProfileRecord | null>(PROFILE_KEY(userId), (prev) =>
        prev ? { ...prev, voice_webhook_token: token } : prev,
      );
    },
  });
}

export function useRotateVoiceToken(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('Not signed in');
      return rotateVoiceWebhookToken(userId);
    },
    onSuccess: (token) => {
      queryClient.setQueryData<ProfileRecord | null>(PROFILE_KEY(userId), (prev) =>
        prev ? { ...prev, voice_webhook_token: token } : prev,
      );
    },
  });
}

export function useSetVoiceTargetWidget(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (widgetId: string | null) => {
      if (!userId) throw new Error('Not signed in');
      await updateVoiceTargetWidget(userId, widgetId);
      return widgetId;
    },
    onSuccess: (widgetId) => {
      queryClient.setQueryData<ProfileRecord | null>(PROFILE_KEY(userId), (prev) =>
        prev ? { ...prev, voice_target_widget_id: widgetId } : prev,
      );
    },
  });
}

/**
 * Once per session, push the browser's detected IANA timezone
 * (`Intl.DateTimeFormat().resolvedOptions().timeZone`, ignores VPNs) to the
 * profile if it differs from what's stored. The pg_cron end-of-day cleanup
 * relies on this to fire at 04:30 local regardless of where the server sits.
 */
export function useSyncProfileTimezone(userId: string | null) {
  const { data: profile } = useProfile(userId);
  useEffect(() => {
    if (!userId || !profile) return;
    const detected = (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
      } catch {
        return null;
      }
    })();
    if (!detected || detected === profile.timezone) return;
    void updateProfileTimezone(userId, detected);
  }, [userId, profile]);
}
