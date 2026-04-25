import { describe, it, expect } from 'vitest';
import { parseSuggestedStats, STAT_FALLBACK } from './statSuggestionService.js';

describe('parseSuggestedStats', () => {
  it('parses clean JSON', () => {
    const out = parseSuggestedStats('{"might": 5, "magic": 1, "mischief": 1}');
    expect(out.might).toBe(5);
    expect(out.magic).toBe(1);
    expect(out.mischief).toBe(1);
  });

  it('extracts JSON embedded in prose', () => {
    const out = parseSuggestedStats('Here are the stats: {"might": 1, "magic": 5, "mischief": 1} based on wizard class.');
    expect(out.magic).toBe(5);
    expect(out.might).toBe(1);
  });

  it('strips <think> blocks before parsing', () => {
    const out = parseSuggestedStats('<think>A rogue relies on cunning...</think>\n{"might": 1, "magic": 1, "mischief": 5}');
    expect(out.mischief).toBe(5);
    expect(out.might).toBe(1);
  });

  it('rounds float values', () => {
    const out = parseSuggestedStats('{"might": 2.7, "magic": 1.2, "mischief": 3.5}');
    expect(out.might).toBe(3);
    expect(out.magic).toBe(1);
    expect(out.mischief).toBe(4);
  });

  it('clamps values above 5 to 5', () => {
    const out = parseSuggestedStats('{"might": 99, "magic": 1, "mischief": 1}');
    expect(out.might).toBe(5);
  });

  it('clamps values below 1 to 1', () => {
    const out = parseSuggestedStats('{"might": -3, "magic": 0, "mischief": 3}');
    expect(out.might).toBe(1);
    expect(out.magic).toBe(1);
  });

  it('returns fallback for empty string', () => {
    const out = parseSuggestedStats('');
    expect(out.might).toBe(STAT_FALLBACK.might);
    expect(out.magic).toBe(STAT_FALLBACK.magic);
    expect(out.mischief).toBe(STAT_FALLBACK.mischief);
  });

  it('returns fallback for invalid JSON', () => {
    const out = parseSuggestedStats('not json at all');
    expect(out.might).toBe(STAT_FALLBACK.might);
  });

  it('returns fallback for malformed JSON', () => {
    const out = parseSuggestedStats('{might: 3, magic: 2, mischief: 2}');
    expect(out.might).toBe(STAT_FALLBACK.might);
  });

  it('uses per-stat defaults for missing fields', () => {
    const out = parseSuggestedStats('{"might": 4}');
    expect(out.might).toBe(4);
    expect(out.magic).toBe(STAT_FALLBACK.magic);
    expect(out.mischief).toBe(STAT_FALLBACK.mischief);
  });

  it('coerces string numbers', () => {
    const out = parseSuggestedStats('{"might": "3", "magic": "2", "mischief": "2"}');
    expect(out.might).toBe(3);
    expect(out.magic).toBe(2);
  });

  it('strips multi-line <think> blocks', () => {
    const out = parseSuggestedStats(`<think>
This character is a rogue.
Rogues rely on cunning.
</think>
{"might": 2, "magic": 1, "mischief": 4}`);
    expect(out.mischief).toBe(4);
    expect(out.magic).toBe(1);
  });
});
