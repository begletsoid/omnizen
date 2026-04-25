/**
 * Bedtime detection from raw step samples.
 *
 * iOS Shortcuts can't reliably filter HealthKit samples with hour precision —
 * its "in last X" filter is day-only, and "between" with computed dates also
 * collapses to date granularity. So instead of fighting iOS, we let the iPhone
 * dump the last 24h of step samples to the server and figure out bedtime here.
 *
 * Idea: when you sleep, you don't take steps. The longest period of inactivity
 * that ends recently (i.e., the user just woke up) is the night sleep, and its
 * START is approximately when you went to bed. The algorithm has to be robust
 * against:
 *   - Brief night wake-ups (toilet trips: a few steps, a few minutes)
 *   - Daytime naps (treat as separate inactivity, not bedtime)
 *   - Sedentary evenings (TV, reading) — accepted as "approximate bedtime"
 *     since no walking is detectable from steps alone
 *
 * Returned bedtime is best-effort; for our use case (clamping running timers
 * before archiving) ±30-60 minutes is fine.
 */

export type StepSample = {
  /** ISO 8601 string with timezone offset, e.g. "2026-04-24T22:30:00+03:00" */
  start: string;
  end: string;
  /** Number of steps in this sample (HealthKit aggregates per-minute or larger). */
  value: number;
};

type Block = { start: number; end: number; steps: number };
type Gap = { start: number; end: number; duration: number };

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

// Tunables. Defaults chosen to match a typical sleep schedule (lights out
// 21:30–04:00, wake-up 6–11) with at most 1–2 brief night wake-ups.
const BLOCK_MERGE_GAP_MS = 5 * MINUTE_MS;       // samples within 5 min are one block
const SLEEP_GAP_MIN_MS = 3 * HOUR_MS;            // a "long" gap candidate for sleep
const TRANSIENT_BLOCK_MAX_STEPS = 200;           // steps in a brief night wake
const TRANSIENT_BLOCK_MAX_DURATION_MS = 30 * MINUTE_MS;
const RECENT_GAP_END_WINDOW_MS = 12 * HOUR_MS;   // gap must end within last 12h
                                                 //   (otherwise it's a stale day-old gap)

// Steps stop a few minutes before you actually fall asleep — last walk to the
// bedroom, brushing teeth — but Apple Health logs that activity, then a gap,
// then the user is asleep. Pulling bedtime back 5 min closes that small window
// so the cleanup clamp is conservative (won't accidentally count post-bedtime
// time as work) without being aggressive.
const BEDTIME_BACKDATE_MS = 5 * MINUTE_MS;

export type DetectionResult =
  | { kind: 'detected'; bedtime: Date; confidence: 'high' | 'medium' | 'low' }
  | { kind: 'no_sleep_detected'; reason: string };

export function detectBedtime(samples: StepSample[], now: Date): DetectionResult {
  if (samples.length === 0) {
    return { kind: 'no_sleep_detected', reason: 'no samples' };
  }

  // Parse to numeric timestamps and filter out malformed entries.
  const parsed = samples
    .map((s) => ({
      start: Date.parse(s.start),
      end: Date.parse(s.end),
      value: typeof s.value === 'number' && Number.isFinite(s.value) ? s.value : 0,
    }))
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end >= s.start);

  if (parsed.length === 0) {
    return { kind: 'no_sleep_detected', reason: 'all samples malformed' };
  }

  parsed.sort((a, b) => a.start - b.start);

  // 1. Build activity blocks by merging samples whose gap is < 5 min. Apple
  // Health often splits a continuous walk into many small samples; we treat
  // those as a single "block of activity" so a 5-second pause doesn't break it.
  const blocks: Block[] = [];
  for (const s of parsed) {
    const last = blocks[blocks.length - 1];
    if (last && s.start - last.end < BLOCK_MERGE_GAP_MS) {
      last.end = Math.max(last.end, s.end);
      last.steps += s.value;
    } else {
      blocks.push({ start: s.start, end: s.end, steps: s.value });
    }
  }

  // 2. Compute every gap between consecutive blocks.
  const gaps: Gap[] = [];
  for (let i = 1; i < blocks.length; i++) {
    const start = blocks[i - 1].end;
    const end = blocks[i].start;
    gaps.push({ start, end, duration: end - start });
  }

  // 3. Keep only "long" gaps that could plausibly be sleep (>= 3 hours).
  const longGaps = gaps.filter((g) => g.duration >= SLEEP_GAP_MIN_MS);
  if (longGaps.length === 0) {
    return { kind: 'no_sleep_detected', reason: 'no inactivity period >= 3h' };
  }

  // 4. Merge consecutive long gaps separated by a "transient" block — small
  // night wake-ups (toilet, water). A transient block has < 200 steps AND
  // lasts < 30 minutes. Anything bigger is real activity (someone got up and
  // started their day, or a significant nap interruption).
  const merged: Gap[] = [];
  let i = 0;
  while (i < longGaps.length) {
    let combined = { ...longGaps[i] };
    while (i + 1 < longGaps.length) {
      const next = longGaps[i + 1];
      // Find blocks lying between the current combined gap's end and next gap's start.
      const between = blocks.filter((b) => b.start >= combined.end && b.end <= next.start);
      const totalSteps = between.reduce((sum, b) => sum + b.steps, 0);
      const totalDuration = between.reduce((sum, b) => sum + (b.end - b.start), 0);

      if (totalSteps < TRANSIENT_BLOCK_MAX_STEPS && totalDuration < TRANSIENT_BLOCK_MAX_DURATION_MS) {
        // Brief night wake — extend the gap and keep merging.
        combined = { start: combined.start, end: next.end, duration: next.end - combined.start };
        i++;
      } else {
        break;
      }
    }
    merged.push(combined);
    i++;
  }

  // 5. Pick the LONGEST merged gap that ended within the recent window. We
  // prefer "longest" over "most recent" because a user can be sedentary mid-day
  // for 3-4h (long meeting, gaming session) — that creates a recent long-ish
  // gap that's NOT sleep. The actual night sleep is typically longer (6-10h)
  // than any sedentary daytime period, so picking the longest within the recent
  // window robustly identifies the real bedtime.
  const cutoff = now.getTime() - RECENT_GAP_END_WINDOW_MS;
  const recent = merged.filter((g) => g.end >= cutoff);
  const candidates = recent.length > 0 ? recent : merged;

  candidates.sort((a, b) => b.duration - a.duration);
  const winner = candidates[0];

  // Confidence heuristic: long single gap = high; merged with toilet wakes = medium;
  // fallback (no recent gap, picked oldest available) = low.
  const wasMerged = winner.end !== longGaps.find((g) => g.start === winner.start)?.end;
  const isStale = recent.length === 0;
  const confidence: 'high' | 'medium' | 'low' = isStale ? 'low' : wasMerged ? 'medium' : 'high';

  return {
    kind: 'detected',
    bedtime: new Date(winner.start - BEDTIME_BACKDATE_MS),
    confidence,
  };
}

/**
 * Simplified detection that takes ONLY a list of timestamps (e.g. just the
 * Start Date of each step sample) — no end times, no step counts.
 *
 * Use case: iOS Shortcuts can't easily build {start, end, value} objects in a
 * loop, so it's much simpler to just dump the array of Start Dates. We lose
 * some precision (can't distinguish "a 30-minute walk" from "a 30-second walk"
 * since each is just one timestamp), but the gap structure remains clear: long
 * stretches without timestamps = sleep.
 *
 * Toilet-break detection here uses cluster *count* (number of timestamps in
 * the cluster) instead of step count — a brief toilet trip typically logs 1-2
 * step samples, while a real morning walk logs many.
 */
export function detectBedtimeFromTimestamps(
  timestamps: string[],
  now: Date,
): DetectionResult {
  if (timestamps.length === 0) {
    return { kind: 'no_sleep_detected', reason: 'no timestamps' };
  }

  const parsed = timestamps
    .map((t) => Date.parse(t))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);

  if (parsed.length === 0) {
    return { kind: 'no_sleep_detected', reason: 'all timestamps malformed' };
  }

  // Deduplicate adjacent equals (after sort).
  const dedup: number[] = [parsed[0]];
  for (let i = 1; i < parsed.length; i++) {
    if (parsed[i] !== parsed[i - 1]) dedup.push(parsed[i]);
  }

  // Build clusters: timestamps within 5 min of each other = one continuous
  // walking session. Each cluster gets a `count` for transient-wake detection.
  type Cluster = { start: number; end: number; count: number };
  const clusters: Cluster[] = [];
  for (const t of dedup) {
    const last = clusters[clusters.length - 1];
    if (last && t - last.end < BLOCK_MERGE_GAP_MS) {
      last.end = t;
      last.count += 1;
    } else {
      clusters.push({ start: t, end: t, count: 1 });
    }
  }

  const gaps: Gap[] = [];
  for (let i = 1; i < clusters.length; i++) {
    gaps.push({
      start: clusters[i - 1].end,
      end: clusters[i].start,
      duration: clusters[i].start - clusters[i - 1].end,
    });
  }

  const longGaps = gaps.filter((g) => g.duration >= SLEEP_GAP_MIN_MS);
  if (longGaps.length === 0) {
    return { kind: 'no_sleep_detected', reason: 'no inactivity period >= 3h' };
  }

  // Transient: cluster with <= 2 timestamps AND duration < 30 min. A real
  // walking session at ~3am after a toilet break would generate many samples.
  const TRANSIENT_MAX_COUNT = 2;

  const merged: Gap[] = [];
  let i = 0;
  while (i < longGaps.length) {
    let combined = { ...longGaps[i] };
    while (i + 1 < longGaps.length) {
      const next = longGaps[i + 1];
      const between = clusters.filter(
        (c) => c.start >= combined.end && c.end <= next.start,
      );
      const totalCount = between.reduce((s, c) => s + c.count, 0);
      const totalDuration = between.reduce((s, c) => s + (c.end - c.start), 0);
      if (
        totalCount <= TRANSIENT_MAX_COUNT &&
        totalDuration < TRANSIENT_BLOCK_MAX_DURATION_MS
      ) {
        combined = { start: combined.start, end: next.end, duration: next.end - combined.start };
        i++;
      } else {
        break;
      }
    }
    merged.push(combined);
    i++;
  }

  const cutoff = now.getTime() - RECENT_GAP_END_WINDOW_MS;
  const recent = merged.filter((g) => g.end >= cutoff);
  const candidates = recent.length > 0 ? recent : merged;

  candidates.sort((a, b) => b.duration - a.duration);
  const winner = candidates[0];

  const wasMerged = winner.end !== longGaps.find((g) => g.start === winner.start)?.end;
  const isStale = recent.length === 0;
  const confidence: 'high' | 'medium' | 'low' = isStale ? 'low' : wasMerged ? 'medium' : 'high';

  return {
    kind: 'detected',
    bedtime: new Date(winner.start - BEDTIME_BACKDATE_MS),
    confidence,
  };
}
