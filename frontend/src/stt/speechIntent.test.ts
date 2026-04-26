import { describe, expect, it } from 'vitest';
import { parseSpeechIntent } from './speechIntent';

describe('parseSpeechIntent', () => {
  it.each([
    ['1', 0],
    ['one', 0],
    ['first', 0],
    ['option one', 0],
    ['action 2', 1],
    ['second', 1],
    ['number three', 2],
    ['choice 3', 2],
  ])('maps %s to a suggested choice', (text, index) => {
    expect(parseSpeechIntent(text)).toMatchObject({ type: 'choice', index });
  });

  it('treats ambiguous action text as custom text', () => {
    expect(parseSpeechIntent('I run to the first door')).toEqual({
      type: 'custom',
      text: 'I run to the first door',
      transcript: 'I run to the first door',
    });
  });

  it('trims custom text', () => {
    expect(parseSpeechIntent('  cast a tiny shield  ')).toEqual({
      type: 'custom',
      text: 'cast a tiny shield',
      transcript: 'cast a tiny shield',
    });
  });
});

