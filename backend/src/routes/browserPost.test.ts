import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { requireBrowserJsonPost } from './browserPost.js';

vi.mock('../config/env.js', () => ({
  isAllowedOrigin: (origin: string | undefined) => origin === 'https://app.example.com',
}));

const run = (headers: Record<string, string>) => {
  const req = {
    get: (name: string) => headers[name.toLowerCase()],
    is: (type: string) => headers['content-type']?.startsWith(type) ? type : false,
  } as unknown as Request;
  const status = vi.fn().mockReturnThis();
  const json = vi.fn();
  const res = { status, json } as unknown as Response;
  const next = vi.fn();
  requireBrowserJsonPost(true)(req, res, next);
  return { status, next };
};

describe('requireBrowserJsonPost', () => {
  it('allows an allowed Origin with a JSON body', () => {
    expect(run({ origin: 'https://app.example.com', 'content-type': 'application/json' }).next).toHaveBeenCalledOnce();
  });

  it.each([
    ['missing', {}],
    ['null', { origin: 'null' }],
    ['disallowed', { origin: 'https://evil.example.com' }],
  ])('rejects a %s Origin', (_label, originHeader) => {
    const result = run({ ...originHeader, 'content-type': 'application/json' });
    expect(result.status).toHaveBeenCalledWith(403);
    expect(result.next).not.toHaveBeenCalled();
  });

  it('rejects a non-JSON body from an allowed Origin', () => {
    const result = run({ origin: 'https://app.example.com', 'content-type': 'application/x-www-form-urlencoded' });
    expect(result.status).toHaveBeenCalledWith(415);
    expect(result.next).not.toHaveBeenCalled();
  });
});
