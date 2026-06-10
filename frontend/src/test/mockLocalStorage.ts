// Replaces window.localStorage with a fresh in-memory mock for the current test file.
// Defining the property on the test global also makes the bare `localStorage`
// identifier resolve to the mock, which sidesteps Node >= 26 shadowing jsdom's
// localStorage with its built-in (non-functional without --localstorage-file) one.
// Call from beforeEach, same as the inline mocks in useOnboardingTutorial.test.ts
// and GetMeRollin.test.tsx.
export const installMockLocalStorage = () => {
  const store: Record<string, string> = {};
  const mock = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const k of Object.keys(store)) {
        delete store[k];
      }
    },
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: mock });
  return mock;
};
