import { randomUUID } from 'crypto';

export const createId = (): string => randomUUID().replace(/-/g, '').slice(0, 12);
