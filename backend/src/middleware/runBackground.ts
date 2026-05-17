const isDev = process.env.NODE_ENV !== 'production';

export const runBackground = (label: string, fn: () => Promise<void>): void => {
  if (isDev) {
    console.log(`[bg] start ${label}`);
  }
  const start = Date.now();
  void fn().then(() => {
    if (isDev) {
      console.log(`[bg] done ${label} — ${Date.now() - start}ms`);
    }
  }).catch(err => {
    if (isDev) {
      console.log(`[bg] error ${label} — ${Date.now() - start}ms`, err);
    }
  });
};
