import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FirstRunWizard } from './FirstRunWizard';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  audio: {
    settings: { enabled: true, musicEnabled: true, sfxEnabled: true, masterMuted: false, musicVolume: 0.35, sfxVolume: 0.6, sillyMode: false },
    setEnabled: vi.fn(),
    setMusicEnabled: vi.fn(),
    setSfxEnabled: vi.fn(),
    setSillyMode: vi.fn(),
  },
  tts: {
    settings: { enabled: false, autoSpeakNarration: false, provider: 'browser' },
    setProvider: vi.fn(),
    setEnabled: vi.fn(),
    setAutoSpeakNarration: vi.fn(),
  },
  stt: {
    settings: { enabled: false },
    setEnabled: vi.fn(),
  },
}));

vi.mock('../lib/api', () => ({
  apiFetch: mocks.apiFetch,
  imgSrc: (url: string | null | undefined) => url ?? '/images/default_scene.png',
}));

vi.mock('../hooks/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: { hasCloudAI: true, hasTts: true }, loading: false }),
}));

vi.mock('../audio/useAudioSettings', () => ({
  useAudioSettings: () => mocks.audio,
}));

vi.mock('../tts/useTtsSettings', () => ({
  useTtsSettings: () => mocks.tts,
}));

vi.mock('../tts/browserTtsService', () => ({
  browserTtsService: { isSupported: () => true },
}));

vi.mock('../stt/useSttSettings', () => ({
  useSttSettings: () => mocks.stt,
}));

vi.mock('../stt/browserSpeechRecognitionService', () => ({
  getSpeechRecognitionCtor: () => null,
}));

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  });
  mocks.apiFetch.mockResolvedValue(new Response(JSON.stringify({ imagesEnabled: true }), { status: 200 }));
});

describe('FirstRunWizard', () => {
  it('renders the first setup step and skips without saving settings', () => {
    const onSkip = vi.fn();
    render(<FirstRunWizard onComplete={() => {}} onSkip={onSkip} />);

    expect(screen.getByText('First Setup')).toBeInTheDocument();
    expect(screen.getByText('How should the story look?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));

    expect(onSkip).toHaveBeenCalled();
    expect(mocks.tts.setEnabled).not.toHaveBeenCalled();
  });

  it('saves selected settings and completes the wizard', async () => {
    const onComplete = vi.fn();
    render(<FirstRunWizard onComplete={onComplete} onSkip={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByText('AI Narrator'));
    fireEvent.click(screen.getByText('Read new turns automatically'));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByText('ZUG-MA-GEDDON'));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByText('Silly mode'));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText(/change voices, audio, images/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save Setup' }));

    await waitFor(() => expect(onComplete).toHaveBeenCalled());

    expect(mocks.apiFetch).toHaveBeenCalledWith('/settings', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ imagesEnabled: true }),
    }));
    expect(mocks.tts.setProvider).toHaveBeenCalledWith('openai');
    expect(mocks.tts.setEnabled).toHaveBeenCalledWith(true);
    expect(mocks.tts.setAutoSpeakNarration).toHaveBeenCalledWith(true);
    expect(mocks.audio.setSillyMode).toHaveBeenCalledWith(true);
    expect(JSON.parse(localStorage.getItem('dnd-first-run-preferences') ?? '{}')).toEqual({ preferredGameMode: 'zug-ma-geddon' });
  });

  it('can save and hand off to Get Me Rollin', async () => {
    const onComplete = vi.fn();
    const onStartGetMeRollin = vi.fn();
    render(<FirstRunWizard onComplete={onComplete} onSkip={() => {}} onStartGetMeRollin={onStartGetMeRollin} />);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: "Get Me Rollin'" }));

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(onStartGetMeRollin).toHaveBeenCalled();
  });

  it('preselects AI narration on mobile when OpenAI TTS is available', async () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    render(<FirstRunWizard onComplete={() => {}} onSkip={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(screen.getByText('AI Narrator').closest('button')).toHaveClass('border-amber-500');
    });
  });
});
