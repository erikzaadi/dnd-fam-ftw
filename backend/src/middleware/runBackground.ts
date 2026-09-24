import { devLog } from '../lib/devLog.js';

export const runBackground = (label: string, fn: () => Promise<void>): void => {
  devLog.log(`[bg] start ${label}`);
  const start = Date.now();
  void fn().then(() => {
    devLog.log(`[bg] done ${label} - ${Date.now() - start}ms`);
  }).catch(err => {
    // Operational: background failures must be visible in production logs.
    console.error(`[bg] error ${label} - ${Date.now() - start}ms`, err);
  });
};
