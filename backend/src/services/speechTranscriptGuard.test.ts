import { describe, expect, it } from 'vitest';
import { checkSpokenTranscript, speechWords } from './speechTranscriptGuard.js';

const RIDDLE = 'The wood whispers: "I dance on strings, but never play - what am I?" Wobblehat counts 3 silver coins, 12 acorns, and one cracked lantern. Zara of Thistledown answers, "A puppet!" and the old oak creaks open.';

describe('speechWords', () => {
  it('ignores case, punctuation and apostrophes', () => {
    expect(speechWords('"Don’t!" she cried - loudly.')).toEqual(['dont', 'she', 'cried', 'loudly']);
  });

  it('treats digits and number words, however long, as the same placeholder', () => {
    expect(speechWords('counts 21 coins')).toEqual(speechWords('counts twenty-one coins'));
    expect(speechWords('the 3rd door')).toEqual(speechWords('the third door'));
  });
});

describe('checkSpokenTranscript', () => {
  it('accepts an exact reading', () => {
    expect(checkSpokenTranscript(RIDDLE, RIDDLE)).toEqual({ ok: true });
  });

  it('accepts a transcript that spells the numbers out', () => {
    const transcript = RIDDLE.replace('3 silver', 'three silver').replace('12 acorns', 'twelve acorns');

    expect(checkSpokenTranscript(RIDDLE, transcript)).toEqual({ ok: true });
  });

  it('rejects a spoken preamble before the text', () => {
    const transcript = `I’m reading it aloud just as written, word for word.${RIDDLE}`;

    expect(checkSpokenTranscript(RIDDLE, transcript)).toEqual({ ok: false, reason: 'added_or_missing_start' });
  });

  it('rejects a comment added after the text', () => {
    expect(checkSpokenTranscript(RIDDLE, `${RIDDLE} Would you like to hear more?`)).toEqual({ ok: false, reason: 'added_or_missing_end' });
  });

  it('rejects a reading that stops early', () => {
    const transcript = RIDDLE.slice(0, RIDDLE.indexOf('Zara'));

    expect(checkSpokenTranscript(RIDDLE, transcript)).toEqual({ ok: false, reason: 'added_or_missing_end' });
  });

  it('rejects a reading that skips the middle', () => {
    const transcript = 'The wood whispers: and the old oak creaks open.';

    expect(checkSpokenTranscript(RIDDLE, transcript)).toEqual({ ok: false, reason: 'length_differs' });
  });

  it('rejects an empty transcript', () => {
    expect(checkSpokenTranscript(RIDDLE, '').ok).toBe(false);
  });

  it('handles texts shorter than the edge window', () => {
    expect(checkSpokenTranscript('Run!', 'Run.')).toEqual({ ok: true });
    expect(checkSpokenTranscript('Run!', 'Sure. Run.').ok).toBe(false);
  });
});
