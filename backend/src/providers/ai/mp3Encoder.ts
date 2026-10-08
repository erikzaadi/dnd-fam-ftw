import { Mp3Encoder } from '@breezystack/lamejs';

// Realtime speech arrives as raw PCM16; clients get MP3, about a sixth of the size.
export const SPEECH_PCM_SAMPLE_RATE = 24000;
const SPEECH_MP3_KBPS = 64;

export interface PcmToMp3Encoder {
  push(pcm: Buffer): void;
  finish(): Buffer;
}

// Encodes mono PCM16 little-endian as it streams in. Each chunk is a fraction of
// a second of audio and takes a few milliseconds, so encoding piece by piece on
// the main thread never holds the event loop for long.
export function createPcmToMp3Encoder(sampleRate: number = SPEECH_PCM_SAMPLE_RATE, kbps: number = SPEECH_MP3_KBPS): PcmToMp3Encoder {
  const encoder = new Mp3Encoder(1, sampleRate, kbps);
  const frames: Buffer[] = [];
  // A chunk may end halfway through a 16-bit sample; the odd byte waits for the next one.
  let carry: Buffer = Buffer.alloc(0);
  let sawSamples = false;

  return {
    push(pcm) {
      const bytes = carry.length > 0 ? Buffer.concat([carry, pcm]) : pcm;
      const sampleCount = Math.floor(bytes.length / 2);
      carry = bytes.subarray(sampleCount * 2);
      if (sampleCount === 0) {
        return;
      }
      sawSamples = true;
      const samples = new Int16Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) {
        samples[i] = bytes.readInt16LE(i * 2);
      }
      const encoded = encoder.encodeBuffer(samples);
      if (encoded.length > 0) {
        frames.push(Buffer.from(encoded));
      }
    },
    finish() {
      if (!sawSamples) {
        return Buffer.alloc(0);
      }
      const tail = encoder.flush();
      if (tail.length > 0) {
        frames.push(Buffer.from(tail));
      }
      return Buffer.concat(frames);
    },
  };
}
