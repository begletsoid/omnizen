import { describe, expect, it } from 'vitest';

import { looksLikeHallucination } from '../stt';

describe('looksLikeHallucination', () => {
  it('rejects empty / too short transcripts', () => {
    expect(looksLikeHallucination('')).toBe(true);
    expect(looksLikeHallucination('a')).toBe(true);
    expect(looksLikeHallucination('ok')).toBe(true);
  });

  it('rejects known Whisper noise patterns (English)', () => {
    expect(looksLikeHallucination('Subtitles by the Amara.org community')).toBe(true);
    expect(looksLikeHallucination('Transcribed by some service')).toBe(true);
  });

  it('rejects known Whisper noise patterns (Russian)', () => {
    expect(looksLikeHallucination('Спасибо за просмотр')).toBe(true);
    expect(looksLikeHallucination('Субтитры подготовлены сообществом')).toBe(true);
    expect(looksLikeHallucination('Продолжение следует...')).toBe(true);
    expect(looksLikeHallucination('Продолжение следует')).toBe(true);
    expect(looksLikeHallucination('To be continued...')).toBe(true);
    expect(looksLikeHallucination('Поехали')).toBe(true);
  });

  it('rejects musical-note glyph (recorded silence)', () => {
    expect(looksLikeHallucination('♪')).toBe(true);
    expect(looksLikeHallucination('♪♪♪')).toBe(true);
  });

  it('rejects dot-only transcripts', () => {
    expect(looksLikeHallucination('...')).toBe(true);
    expect(looksLikeHallucination('  .  ')).toBe(true);
  });

  it('rejects repeated short word loops', () => {
    expect(looksLikeHallucination('да да да да да')).toBe(true);
    expect(looksLikeHallucination('the the the the')).toBe(true);
  });

  it('accepts legitimate Russian phrases', () => {
    expect(looksLikeHallucination('Делаю код-ревью PR-1234')).toBe(false);
    expect(looksLikeHallucination('Купил билет в кино за 800 рублей')).toBe(false);
    expect(looksLikeHallucination('Начинаю работу над презентацией для понедельника')).toBe(false);
  });

  it('accepts legitimate short phrases', () => {
    expect(looksLikeHallucination('Обед')).toBe(false);
    expect(looksLikeHallucination('Спорт')).toBe(false);
  });
});
