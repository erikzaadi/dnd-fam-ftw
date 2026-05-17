import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageReadyEvent } from '../types';
import { useSessionEvents } from './useSessionEvents';

vi.mock('../audio/audioManager', () => ({
  audioManager: { setTension: vi.fn(), playSfx: vi.fn() },
}));

class FakeEventSource {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;

  fire(data: object) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }

  close() {}
}

let fakeEs: FakeEventSource;

beforeEach(() => {
  fakeEs = new FakeEventSource();
   
  vi.stubGlobal('EventSource', vi.fn(function() {
    return fakeEs; 
  }));
});

const makeHandlers = () => ({
  sessionId: 'test-session',
  onNarrating: vi.fn(),
  onTurnComplete: vi.fn(),
  onTurnError: vi.fn(),
  onImageReady: vi.fn(),
  onIntervention: vi.fn(),
  onSanctuaryRecovery: vi.fn(),
  onPartyUpdate: vi.fn(),
  onGameOver: vi.fn(),
});

describe('useSessionEvents image_ready delivery', () => {
  it('delivers scene target with imageUrl', () => {
    const handlers = makeHandlers();
    renderHook(() => useSessionEvents(handlers));

    fakeEs.fire({ type: 'image_ready', target: 'scene', imageUrl: 'http://example.com/scene.png' });

    expect(handlers.onImageReady).toHaveBeenCalledOnce();
    const event = handlers.onImageReady.mock.calls[0][0] as ImageReadyEvent;
    expect(event.type).toBe('image_ready');
    expect(event.target).toBe('scene');
    if (event.target === 'scene') {
      expect(event.imageUrl).toBe('http://example.com/scene.png');
    }
  });

  it('delivers encounter_enemy target with encounterId, enemyId, imageUrl', () => {
    const handlers = makeHandlers();
    renderHook(() => useSessionEvents(handlers));

    fakeEs.fire({ type: 'image_ready', target: 'encounter_enemy', encounterId: 'enc1', enemyId: 'en1', imageUrl: 'http://example.com/enemy.png' });

    const event = handlers.onImageReady.mock.calls[0][0] as ImageReadyEvent;
    expect(event.target).toBe('encounter_enemy');
    if (event.target === 'encounter_enemy') {
      expect(event.encounterId).toBe('enc1');
      expect(event.enemyId).toBe('en1');
      expect(event.imageUrl).toBe('http://example.com/enemy.png');
    }
  });

  it('delivers encounter_area target with encounterId, areaId, imageUrl', () => {
    const handlers = makeHandlers();
    renderHook(() => useSessionEvents(handlers));

    fakeEs.fire({ type: 'image_ready', target: 'encounter_area', encounterId: 'enc1', areaId: 'area1', imageUrl: 'http://example.com/area.png' });

    const event = handlers.onImageReady.mock.calls[0][0] as ImageReadyEvent;
    expect(event.target).toBe('encounter_area');
    if (event.target === 'encounter_area') {
      expect(event.encounterId).toBe('enc1');
      expect(event.areaId).toBe('area1');
      expect(event.imageUrl).toBe('http://example.com/area.png');
    }
  });

  it('delivers character_avatar target with characterId and imageUrl', () => {
    const handlers = makeHandlers();
    renderHook(() => useSessionEvents(handlers));

    fakeEs.fire({ type: 'image_ready', target: 'character_avatar', characterId: 'char1', imageUrl: 'http://example.com/avatar.png' });

    const event = handlers.onImageReady.mock.calls[0][0] as ImageReadyEvent;
    expect(event.target).toBe('character_avatar');
    if (event.target === 'character_avatar') {
      expect(event.characterId).toBe('char1');
      expect(event.imageUrl).toBe('http://example.com/avatar.png');
    }
  });

  it('delivers session_preview target with imageUrl', () => {
    const handlers = makeHandlers();
    renderHook(() => useSessionEvents(handlers));

    fakeEs.fire({ type: 'image_ready', target: 'session_preview', imageUrl: 'http://example.com/preview.png' });

    const event = handlers.onImageReady.mock.calls[0][0] as ImageReadyEvent;
    expect(event.target).toBe('session_preview');
    if (event.target === 'session_preview') {
      expect(event.imageUrl).toBe('http://example.com/preview.png');
    }
  });
});
