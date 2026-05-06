/**
 * Audio file → Supabase Storage. Path convention:
 *   <user_id>/<yyyy-mm>/<random-uuid>.<ext>
 *
 * The first segment is the user's UUID, which lets the Storage RLS policy
 * `voice_recordings_owner_read` filter by `(storage.foldername(name))[1]`
 * (see migration 20260505000000_voice_microtask.sql).
 */

import { type SupabaseClient } from '@supabase/supabase-js';

const BUCKET = 'voice-recordings';

function pickExtension(filename: string, mimeType: string): string {
  const lower = filename.toLowerCase();
  for (const ext of ['m4a', 'mp3', 'wav', 'ogg', 'aac', 'flac', 'webm', 'mp4']) {
    if (lower.endsWith(`.${ext}`)) return ext;
  }
  if (mimeType.includes('m4a') || mimeType.includes('mp4')) return 'm4a';
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('webm')) return 'webm';
  return 'm4a'; // sensible default — iOS Voice Recorder produces m4a/AAC.
}

function monthSegment(date = new Date()): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

export type UploadedAudio = {
  path: string;
  size: number;
  mimeType: string;
};

export async function uploadAudio(
  supabase: SupabaseClient,
  args: {
    userId: string;
    file: File;
    idempotencyKey: string;
  },
): Promise<UploadedAudio> {
  const ext = pickExtension(args.file.name ?? '', args.file.type ?? '');
  // We use idempotency_key as the filename so a retried POST overwrites the
  // same blob (`upsert: true`) instead of leaving orphans on each retry.
  const path = `${args.userId}/${monthSegment()}/${args.idempotencyKey}.${ext}`;
  const arrayBuffer = await args.file.arrayBuffer();
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, new Uint8Array(arrayBuffer), {
      contentType: args.file.type || `audio/${ext}`,
      upsert: true,
    });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return {
    path,
    size: arrayBuffer.byteLength,
    mimeType: args.file.type || `audio/${ext}`,
  };
}

/** Stream the audio back from Storage for STT (used by transcribeAudio). */
export async function downloadAudio(
  supabase: SupabaseClient,
  path: string,
): Promise<Blob> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) throw new Error(`Storage download failed: ${error.message}`);
  return data;
}
