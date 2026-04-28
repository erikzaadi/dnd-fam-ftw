import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { Plugin, ViteDevServer } from 'vite';

const VIRTUAL_ID = 'virtual:audio-catalog';
const RESOLVED_ID = '\0virtual:audio-catalog';

function kebabToCamel(s: string): string {
  return s.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter(f => {
      try {
        return statSync(join(dir, f)).isFile() && f.endsWith('.mp3');
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir).filter(f => {
      try {
        return statSync(join(dir, f)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

function generateModule(publicDir: string, base: string): string {
  const soundDir = join(publicDir, 'sound');

  // Music: sound/music/<category>/*.mp3
  const musicDir = join(soundDir, 'music');
  const music: Record<string, string[]> = {};
  for (const cat of listDirs(musicDir)) {
    music[cat] = listFiles(join(musicDir, cat)).map(f => `${base}sound/music/${cat}/${f}`);
  }

  // SFX: sound/sfx/<event>/*.mp3 (normal) + sound/sfx/<event>/silly/*.mp3 (silly)
  const sfxDir = join(soundDir, 'sfx');
  const sfx: Record<string, { normal: string[]; silly: string[] }> = {};
  for (const event of listDirs(sfxDir)) {
    const eventDir = join(sfxDir, event);
    const key = kebabToCamel(event);
    const normal = listFiles(eventDir).map(f => `${base}sound/sfx/${event}/${f}`);
    const silly = listFiles(join(eventDir, 'silly')).map(f => `${base}sound/sfx/${event}/silly/${f}`);
    sfx[key] = { normal, silly };
  }

  return `export const audioCatalog = ${JSON.stringify({ music, sfx }, null, 2)};`;
}

export function audioCatalogPlugin(publicDir: string, base = '/'): Plugin {
  return {
    name: 'audio-catalog',

    resolveId(id) {
      if (id === VIRTUAL_ID) {
        return RESOLVED_ID;
      }
    },

    load(id) {
      if (id === RESOLVED_ID) {
        return generateModule(publicDir, base);
      }
    },

    configureServer(server: ViteDevServer) {
      const soundDir = join(publicDir, 'sound');
      server.watcher.add(soundDir);
      server.watcher.on('all', (_, file) => {
        if (!file.startsWith(soundDir)) {
          return;
        }
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) {
          server.moduleGraph.invalidateModule(mod);
        }
        server.ws.send({ type: 'full-reload' });
      });
    },
  };
}
