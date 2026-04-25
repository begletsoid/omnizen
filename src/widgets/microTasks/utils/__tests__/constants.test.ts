import { describe, expect, it } from 'vitest';

import {
  CATEGORY_COLOR_PRESETS,
  getCategoryColorPreset,
  pickFirstFreePresetId,
  resolveColorHex,
} from '../constants';

describe('CATEGORY_COLOR_PRESETS', () => {
  it('exposes 7 unique preset ids, each with a hex value', () => {
    const ids = CATEGORY_COLOR_PRESETS.map((p) => p.id);
    expect(ids.length).toBe(7);
    expect(new Set(ids).size).toBe(7);
    for (const preset of CATEGORY_COLOR_PRESETS) {
      expect(preset.hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('resolveColorHex', () => {
  it('maps a preset id to its hex', () => {
    expect(resolveColorHex('rose')).toBe(getCategoryColorPreset('rose').hex);
    expect(resolveColorHex('emerald')).toBe(getCategoryColorPreset('emerald').hex);
  });

  it('returns the literal value for legacy hex strings', () => {
    expect(resolveColorHex('#ff00aa')).toBe('#ff00aa');
  });

  it('falls back to the neutral preset for null/undefined/unknown ids', () => {
    const neutralHex = CATEGORY_COLOR_PRESETS[0].hex;
    expect(resolveColorHex(null)).toBe(neutralHex);
    expect(resolveColorHex(undefined)).toBe(neutralHex);
    expect(resolveColorHex('not-a-preset')).toBe(neutralHex);
  });

  it('accepts a custom fallback', () => {
    expect(resolveColorHex(null, '#abcdef')).toBe('#abcdef');
  });
});

describe('pickFirstFreePresetId', () => {
  it('returns the first preset id not present in the used set', () => {
    // First taken is "neutral" → next free is "rose".
    expect(pickFirstFreePresetId(['neutral'])).toBe('rose');
  });

  it('skips legacy hex values when computing availability', () => {
    // Legacy hex doesn't reserve any preset slot; neutral is still free.
    expect(pickFirstFreePresetId(['#ff0000'])).toBe('neutral');
  });

  it('returns null when every preset is taken', () => {
    const all = CATEGORY_COLOR_PRESETS.map((p) => p.id);
    expect(pickFirstFreePresetId(all)).toBeNull();
  });

  it('returns the first preset when nothing is used', () => {
    expect(pickFirstFreePresetId([])).toBe(CATEGORY_COLOR_PRESETS[0].id);
  });

  it('ignores null/undefined entries', () => {
    expect(pickFirstFreePresetId([null, undefined, 'neutral'])).toBe('rose');
  });
});
