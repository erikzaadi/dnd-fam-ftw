import type { Response } from 'express';

export const sendRateLimitResponse = (res: Response, error: unknown): boolean => {
  const status = (error as { status?: number })?.status;
  if (status !== 429) {
    return false;
  }

  res.status(429).json({
    error: 'rate_limit',
    message: 'The AI is overwhelmed with requests. Wait a moment and try again.',
  });
  return true;
};
