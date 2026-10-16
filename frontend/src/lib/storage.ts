// localStorage that never throws. When a browser blocks site data, even reading
// window.localStorage throws; reads then return null and writes do nothing, so
// tutorials and tips just show again instead of breaking the page.
const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const readStorage = (key: string): string | null => {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

// null removes the key.
export const writeStorage = (key: string, value: string | null): void => {
  try {
    const store = storage();
    if (value === null) {
      store?.removeItem(key);
    } else {
      store?.setItem(key, value);
    }
  } catch {
    // Storage blocked or full: the preference is simply not remembered.
  }
};
