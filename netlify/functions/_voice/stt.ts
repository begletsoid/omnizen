/**
 * Speech-to-text with provider fallback (Groq → OpenAI) + hallucination filter.
 *
 * Why this layout (and not self-hosted Whisper like Artyom):
 *   - We're on Netlify serverless. Nowhere to host MLX/faster-whisper.
 *   - Groq's whisper-large-v3-turbo is 5-10x faster than OpenAI's whisper-1
 *     and ~3x cheaper. Primary path is Groq; OpenAI is only fallback.
 *   - Both speak the OpenAI-compatible /audio/transcriptions API, so the
 *     request shape is identical aside from the URL + key.
 *
 * Hallucination filter: Whisper-large-v3 occasionally fabricates text on
 * silent or near-silent audio ("Subtitles by Vassar College", "Спасибо за
 * просмотр", "♪", repeated phrases). The plan calls for a server-side guard
 * BEFORE we burn LLM tokens classifying nonsense.
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const OPENAI_URL = 'https://api.openai.com/v1/audio/transcriptions';

const GROQ_MODEL = 'whisper-large-v3-turbo';
const OPENAI_MODEL = 'whisper-1';

const HALLUCINATION_PATTERNS: ReadonlyArray<RegExp> = [
  /subtitles?\s+by/i,
  /transcribed\s+by/i,
  /спасибо\s+за\s+просмотр/i,
  /субтитры/i,
  // Whisper-large-v3-turbo loves emitting "Продолжение следует..." on
  // silent audio (it's a YouTube cliffhanger phrase from training data).
  /продолжение\s+следует/i,
  /to\s+be\s+continued/i,
  // "Поехали", "Поехали поехали" — another silence-on-cyrillic artefact.
  /^поехали\s*[.…!]*$/i,
  /^♪+$/,
  /^\s*\.+\s*$/, // just dots
  /^(.{1,5})\s*\1\s*\1/, // same short word repeated 3+ times back-to-back
];

const MIN_TRANSCRIPT_CHARS = 3;
const MIN_AUDIO_DURATION_MS = 1000;

export type SttSuccess = {
  ok: true;
  transcript: string;
  provider: 'groq' | 'openai';
};

export type SttFailure = {
  ok: false;
  reason: 'hallucination' | 'too_short_audio' | 'all_providers_failed';
  detail: string;
  // Even on hallucination we surface the raw text so it lands in the row for
  // future debugging (without firing LLM/dispatcher).
  transcript?: string;
};

export type SttResult = SttSuccess | SttFailure;

/** Per-call API client: sends multipart with the audio Blob to either provider. */
async function callWhisperApi(
  url: string,
  apiKey: string,
  model: string,
  audio: Blob,
): Promise<string> {
  const form = new FormData();
  form.append('file', audio, 'audio.m4a');
  form.append('model', model);
  // Russian-only: matches the user's voice notes. Without explicit language
  // Whisper sometimes mis-detects on short clips, e.g. flips to English.
  form.append('language', 'ru');
  form.append('temperature', '0');
  form.append('response_format', 'json');
  // No `prompt:` field — non-empty prompts measurably increase hallucination
  // rate on silence (per Whisper docs and Plan agent's research).

  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Whisper ${url}: HTTP ${response.status} ${body.slice(0, 200)}`);
  }
  const json = (await response.json()) as { text?: string };
  if (typeof json.text !== 'string') {
    throw new Error(`Whisper response missing text field`);
  }
  return json.text.trim();
}

export function looksLikeHallucination(transcript: string): boolean {
  if (transcript.length < MIN_TRANSCRIPT_CHARS) return true;
  return HALLUCINATION_PATTERNS.some((pattern) => pattern.test(transcript));
}

export async function transcribeAudio(
  audio: Blob,
  audioDurationMs: number | null,
): Promise<SttResult> {
  if (audioDurationMs !== null && audioDurationMs < MIN_AUDIO_DURATION_MS) {
    return {
      ok: false,
      reason: 'too_short_audio',
      detail: `audio is only ${audioDurationMs}ms (min ${MIN_AUDIO_DURATION_MS}ms)`,
    };
  }

  const groqKey = process.env.GROQ_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  const errors: string[] = [];
  let transcript: string | null = null;
  let provider: 'groq' | 'openai' | null = null;

  // Primary: Groq.
  if (groqKey) {
    try {
      transcript = await callWhisperApi(GROQ_URL, groqKey, GROQ_MODEL, audio);
      provider = 'groq';
    } catch (err) {
      errors.push(`groq: ${(err as Error).message}`);
    }
  } else {
    errors.push('groq: GROQ_API_KEY missing');
  }

  // Fallback: OpenAI.
  if (!transcript && openaiKey) {
    try {
      transcript = await callWhisperApi(OPENAI_URL, openaiKey, OPENAI_MODEL, audio);
      provider = 'openai';
    } catch (err) {
      errors.push(`openai: ${(err as Error).message}`);
    }
  } else if (!transcript) {
    errors.push('openai: OPENAI_API_KEY missing');
  }

  if (!transcript || !provider) {
    return {
      ok: false,
      reason: 'all_providers_failed',
      detail: errors.join(' | '),
    };
  }

  if (looksLikeHallucination(transcript)) {
    return {
      ok: false,
      reason: 'hallucination',
      detail: `transcript looks like Whisper noise: "${transcript.slice(0, 80)}"`,
      transcript,
    };
  }

  return { ok: true, transcript, provider };
}
