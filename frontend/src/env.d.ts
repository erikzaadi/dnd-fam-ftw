declare module 'virtual:audio-catalog' {
  export const audioCatalog: {
    music: Record<string, string[]>;
    sfx: Record<string, { normal: string[]; silly: string[] }>;
  };
  export const ttsPhrasesCatalog: Record<string, Record<string, string>>;
}
