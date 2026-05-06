/**
 * Frontend mirror of voice_transcriptions row shape.
 *
 * Mirrors the table from supabase/migrations/20260505000000_voice_microtask.sql.
 * Only fields we need to display/react to are listed; the rest can be added
 * as the UI grows (e.g. a History view that shows raw_transcript).
 */

export type VoiceStatus =
  | 'received'
  | 'processing'
  | 'applied'
  | 'error_stt'
  | 'error_llm'
  | 'error_apply'
  | 'error_hallucination'
  | 'error_quota'
  | 'error_unknown_intent';

export type VoiceTranscriptionRow = {
  id: string;
  user_id: string;
  status: VoiceStatus;
  raw_transcript: string | null;
  applied_intent: string | null;
  applied_payload: Record<string, unknown> | null;
  applied_task_id: string | null;
  paused_task_id: string | null;
  error_detail: string | null;
  audio_path: string;
  created_at: string;
  updated_at: string;
};

export type Database = {
  voice_transcriptions: VoiceTranscriptionRow;
};
