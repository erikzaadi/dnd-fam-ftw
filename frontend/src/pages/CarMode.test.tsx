
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CarMode } from './CarMode';
import { useTtsSettings } from '../tts/useTtsSettings';
import { useSttSettings } from '../stt/useSttSettings';
import { useCarSessionRuntime } from '../session/car/useCarSessionRuntime';
import { useCarConductor } from '../session/car/useCarConductor';

vi.mock('../tts/useTtsSettings', () => ({
  useTtsSettings: vi.fn(),
}));

vi.mock('../stt/useSttSettings', () => ({
  useSttSettings: vi.fn(),
}));

vi.mock('../hooks/useCapabilities', () => ({
  useCapabilities: vi.fn().mockReturnValue({ capabilities: { hasTts: true }, loading: false }),
}));

vi.mock('../session/car/useCarSessionRuntime', () => ({
  useCarSessionRuntime: vi.fn(),
}));

vi.mock('../session/car/useCarConductor', () => ({
  useCarConductor: vi.fn(),
}));

vi.mock('../components/SiteHeader', () => ({
  SiteHeader: () => null,
}));

describe('CarMode', () => {
  const mockSetTtsEnabled = vi.fn();
  const mockSetSttEnabled = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useTtsSettings).mockReturnValue({
      settings: { enabled: false } as unknown as ReturnType<typeof useTtsSettings>['settings'],
      setEnabled: mockSetTtsEnabled,
    } as unknown as ReturnType<typeof useTtsSettings>);

    vi.mocked(useSttSettings).mockReturnValue({
      settings: { enabled: false } as unknown as ReturnType<typeof useSttSettings>['settings'],
      setEnabled: mockSetSttEnabled,
    } as unknown as ReturnType<typeof useSttSettings>);

    vi.mocked(useCarSessionRuntime).mockReturnValue({
      session: { displayName: 'Car Mode Realm', scene: 'Dark Woods', party: [] } as unknown as ReturnType<typeof useCarSessionRuntime>['session'],
      history: [],
      loading: false,
      actionError: null,
      connectionState: 'connected',
      submitAction: vi.fn(),
      previewAction: vi.fn(),
      actionPreview: null,
      clearPreview: vi.fn(),
      previewThinking: false,
    } as unknown as ReturnType<typeof useCarSessionRuntime>);

    vi.mocked(useCarConductor).mockReturnValue({
      conductorState: 'idle',
      isPaused: false,
      transcriptLog: ['System: Welcome to Car Mode'],
      currentSegmentType: null,
      pauseConductor: vi.fn(),
      resumeConductor: vi.fn(),
      speakFullStorySequence: vi.fn(),
      speakOptionsAndPrompt: vi.fn(),
      sttError: null,
      sttStatus: 'idle',
      recognizedTranscript: '',
    } as unknown as ReturnType<typeof useCarConductor>);
  });

  const renderComponent = () => {
    return render(
      <MemoryRouter initialEntries={['/session/session-id/car']}>
        <Routes>
          <Route path="/session/:id/car" element={<CarMode />} />
        </Routes>
      </MemoryRouter>
    );
  };

  it('renders blocking setup page when TTS or STT is disabled', () => {
    renderComponent();
    expect(screen.getByText('Voice Setup Required')).toBeInTheDocument();
    expect(screen.getByText('Exit to Standard Mode')).toBeInTheDocument();
  });

  it('calls setTtsEnabled/setSttEnabled when clicking toggle buttons', () => {
    renderComponent();
    const enableButtons = screen.getAllByRole('button', { name: 'Enable' });
    
    // First is Narration Voice enable button
    fireEvent.click(enableButtons[0]);
    expect(mockSetTtsEnabled).toHaveBeenCalledWith(true);

    // Second is STT voice actions enable button
    fireEvent.click(enableButtons[1]);
    expect(mockSetSttEnabled).toHaveBeenCalledWith(true);
  });

  it('renders car mode dashboard when settings are active', () => {
    vi.mocked(useTtsSettings).mockReturnValue({
      settings: { enabled: true } as unknown as ReturnType<typeof useTtsSettings>['settings'],
      setEnabled: mockSetTtsEnabled,
    } as unknown as ReturnType<typeof useTtsSettings>);

    vi.mocked(useSttSettings).mockReturnValue({
      settings: { enabled: true } as unknown as ReturnType<typeof useSttSettings>['settings'],
      setEnabled: mockSetSttEnabled,
    } as unknown as ReturnType<typeof useSttSettings>);

    renderComponent();

    expect(screen.getByText('Car Mode Realm')).toBeInTheDocument();
    expect(screen.getByText('Active Scene:')).toBeInTheDocument();
    expect(screen.getByText('Dark Woods')).toBeInTheDocument();
    expect(screen.getByText('PAUSED')).toBeInTheDocument();
    expect(screen.getByText('Recent Voice Logs')).toBeInTheDocument();
    expect(screen.getByText('System: Welcome to Car Mode')).toBeInTheDocument();
  });
});
