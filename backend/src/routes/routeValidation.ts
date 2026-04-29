import type { Request, Response } from 'express';
import { z, type ZodType } from 'zod';

export const parseBody = <T>(req: Request, res: Response, schema: ZodType<T>): T | undefined => {
  const result = schema.safeParse(req.body);
  if (result.success) {
    return result.data;
  }

  res.status(400).json({
    error: 'invalid_request',
    issues: z.treeifyError(result.error),
  });
  return undefined;
};

export const booleanBodySchema = z.object({
  enabled: z.boolean(),
});
