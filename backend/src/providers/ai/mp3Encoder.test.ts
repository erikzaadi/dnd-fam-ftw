import { describe, expect, it } from 'vitest';
import { createPcmToMp3Encoder, SPEECH_PCM_SAMPLE_RATE } from './mp3Encoder.js';

function sineWave(seconds: number): Buffer {
  const sampleCount = Math.round(seconds * SPEECH_PCM_SAMPLE_RATE);
  const pcm = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) {
    pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / SPEECH_PCM_SAMPLE_RATE) * 12000), i * 2);
  }
  return pcm;
}

// MP3 frames start with 11 set bits (the frame sync).
const startsWithMp3Frame = (mp3: Buffer) => mp3[0] === 0xff && (mp3[1] & 0xe0) === 0xe0;

describe('createPcmToMp3Encoder', () => {
  it('encodes PCM into a much smaller MP3', () => {
    const pcm = sineWave(2);
    const encoder = createPcmToMp3Encoder();

    encoder.push(pcm);
    const mp3 = encoder.finish();

    expect(startsWithMp3Frame(mp3)).toBe(true);
    // 64 kbps is 8000 bytes per second; allow for frame padding.
    expect(mp3.length).toBeGreaterThan(12000);
    expect(mp3.length).toBeLessThan(pcm.length / 4);
  });

  it('gives the same audio when the PCM arrives in uneven chunks that split samples', () => {
    const pcm = sineWave(1);
    const whole = createPcmToMp3Encoder();
    whole.push(pcm);
    const expected = whole.finish();

    const chunked = createPcmToMp3Encoder();
    for (let offset = 0; offset < pcm.length; offset += 1001) {
      chunked.push(pcm.subarray(offset, offset + 1001));
    }

    expect(chunked.finish().equals(expected)).toBe(true);
  });

  it('returns an empty buffer when no audio was pushed', () => {
    expect(createPcmToMp3Encoder().finish().length).toBe(0);
  });
});
