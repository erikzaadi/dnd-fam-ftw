import { describe, expect, it } from 'vitest';
import { estimateCostUsd, type CostInput } from './usagePricing.js';

const text = (model: string, inputTokens: number, outputTokens: number, serviceTier?: string): CostInput => ({
  kind: 'text', model, inputTokens, outputTokens, ttsCharacters: null, imageCount: null, serviceTier,
});

describe('estimateCostUsd', () => {
  it.each([
    ['gpt-6-luna', 0.1, 0.5],
    ['gpt-5.6-luna', 0.2, 1.2],
    ['gpt-4.1-mini', 0.4, 1.6],
    ['gpt-4.1', 2, 8],
  ])('prices %s at its list price, not the unknown-model fallback', (model, input, output) => {
    expect(estimateCostUsd(text(model, 1000, 100))).toBeCloseTo((1000 * input + 100 * output) / 1_000_000);
  });

  it('prices a dated snapshot like its base model', () => {
    expect(estimateCostUsd(text('gpt-6-luna-2026-09-01', 1000, 100))).toBeCloseTo(estimateCostUsd(text('gpt-6-luna', 1000, 100)));
  });

  it('prices an unknown model conservatively', () => {
    expect(estimateCostUsd(text('some-new-model', 1000, 100))).toBeCloseTo((1000 * 2 + 100 * 8) / 1_000_000);
  });

  it('prices gpt-image-2 by text input and image output tokens', () => {
    expect(estimateCostUsd({ kind: 'image', model: 'gpt-image-2', inputTokens: 100, outputTokens: 1000, ttsCharacters: null, imageCount: 1 }))
      .toBeCloseTo((100 * 5 + 1000 * 30) / 1_000_000);
  });

  it.each(['priority', 'fast'])('doubles the estimate for Fast mode (service_tier %s)', (serviceTier) => {
    expect(estimateCostUsd(text('gpt-6-luna', 1000, 100, serviceTier))).toBeCloseTo(2 * estimateCostUsd(text('gpt-6-luna', 1000, 100)));
  });

  it.each(['default', 'auto', 'flex'])('keeps Standard prices for service_tier %s', (serviceTier) => {
    expect(estimateCostUsd(text('gpt-6-luna', 1000, 100, serviceTier))).toBeCloseTo(estimateCostUsd(text('gpt-6-luna', 1000, 100)));
  });
});
