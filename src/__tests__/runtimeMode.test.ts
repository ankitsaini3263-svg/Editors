import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getRuntimeMode,
  setRuntimeMode,
  subscribeRuntimeMode,
  isLiveMode,
  isDemoMode,
  canEnableDemoMode,
  DemoModeUnavailableError,
  NotImplementedError,
} from '../services/runtimeConfig';
import { whisperService } from '../services/whisperTranscriber';
import { sileroVadService } from '../services/sileroVad';
import { nativeBridge } from '../services/nativeBridge';
import { exportEngine } from '../engine/exportEngine';
import { sam2Engine } from '../engine/sam2Masking';

import { agentOrchestrator } from '../services/agentOrchestrator';

describe('RuntimeMode & Safe-by-Default Boundary (R0.3)', () => {
  beforeEach(() => {
    // Reset to live mode before each test
    setRuntimeMode('live');
  });

  it('defaults to "live" mode out of the box (Safe-by-Default invariant §5.5)', () => {
    expect(getRuntimeMode()).toBe('live');
    expect(isLiveMode()).toBe(true);
    expect(isDemoMode()).toBe(false);
  });

  describe('In Live Mode (Default): All stubs MUST throw NotImplementedError', () => {
    it('whisperService throws NotImplementedError', async () => {
      await expect(whisperService.transcribe('/path/to/test.wav')).rejects.toThrow(NotImplementedError);
      await expect(whisperService.transcribeAudio('/path/to/test.wav')).rejects.toThrow(NotImplementedError);
    });

    it('sileroVadService throws NotImplementedError', async () => {
      await expect(sileroVadService.detectSilence('/path/to/test.wav')).rejects.toThrow(NotImplementedError);
    });

    it('nativeBridge throws NotImplementedError on probe, demux, and proxy', async () => {
      await expect(nativeBridge.importMediaFile('/path/to/test.mp4')).rejects.toThrow(NotImplementedError);
      await expect(nativeBridge.demuxVideoFrames('/path/to/test.mp4', { value: 0, rate: 60000 }, 10)).rejects.toThrow(NotImplementedError);
      await expect(nativeBridge.generateProxy('/path/to/test.mp4')).rejects.toThrow(NotImplementedError);
    });

    it('exportEngine throws NotImplementedError', async () => {
      await expect(
        exportEngine.exportTimeline(
          {
            presetName: 'YouTube 4K',
            width: 3840,
            height: 2160,
            fps: 60,
            bitrateMbps: 50,
            encoder: 'NVENC (NVIDIA)',
            outputPath: '/out/test.mp4',
          },
          () => {}
        )
      ).rejects.toThrow(NotImplementedError);
    });

    it('sam2Engine throws NotImplementedError', async () => {
      await expect(sam2Engine.generateSubjectMask(null, { x: 100, y: 100 })).rejects.toThrow(NotImplementedError);
      await expect(sam2Engine.trackSubjectOverSequence(5, { x: 100, y: 100 })).rejects.toThrow(NotImplementedError);
    });

    it('agentOrchestrator throws NotImplementedError', async () => {
      await expect(agentOrchestrator.processPrompt('cut silence', () => {})).rejects.toThrow(NotImplementedError);
    });
  });

  describe('In Demo Mode (Opt-in): Stubs return preview mock data', () => {
    beforeEach(() => {
      setRuntimeMode('demo');
    });





    it('sam2Engine returns fallback bounding box without throwing', async () => {
      const res = await sam2Engine.generateSubjectMask(null, { x: 200, y: 300 });
      expect(res.confidence).toBe(0.96);
      expect(res.bbox.width).toBe(300);
    });

    it('nativeBridge returns fallback probe metadata without throwing', async () => {
      const res = await nativeBridge.importMediaFile('/path/to/test.mp4');
      expect(res).not.toBeNull();
      expect(res?.fps).toBe(59.94);
      expect(res?.width).toBe(3840);
    });
  });

  it('notifies subscribers when runtime mode changes', () => {
    let observedMode = getRuntimeMode();
    const unsubscribe = subscribeRuntimeMode((newMode) => {
      observedMode = newMode;
    });

    setRuntimeMode('demo');
    expect(observedMode).toBe('demo');

    setRuntimeMode('live');
    expect(observedMode).toBe('live');

    unsubscribe();
    setRuntimeMode('demo');
    // After unsubscribe, observedMode should not update
    expect(observedMode).toBe('live');
  });
});

describe('Demo mode is unavailable outside development builds (R11.3)', () => {
  it('allows demo mode only when the build sets DEV', () => {
    expect(canEnableDemoMode({ DEV: true })).toBe(true);
    expect(canEnableDemoMode({ DEV: false })).toBe(false);
  });

  it('names the refusal distinctly so it is not swallowed as a generic failure', () => {
    const err = new DemoModeUnavailableError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('DemoModeUnavailableError');
    expect(err.message).toMatch(/development-only/);
  });

  it('throws DemoModeUnavailableError when demo mode is attempted in a production build', async () => {
    vi.resetModules();
    vi.stubEnv('DEV', false);
    try {
      const prod = await import('../services/runtimeConfig');
      expect(prod.isDemoModeAvailable()).toBe(false);
      // The mode must not flip before the throw.
      expect(prod.getRuntimeMode()).toBe('live');
      expect(() => prod.setRuntimeMode('demo')).toThrow(prod.DemoModeUnavailableError);
      expect(prod.getRuntimeMode()).toBe('live');
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('keeps live mode reachable in a production build', async () => {
    vi.resetModules();
    vi.stubEnv('DEV', false);
    try {
      const prod = await import('../services/runtimeConfig');
      expect(() => prod.setRuntimeMode('live')).not.toThrow();
      expect(prod.getRuntimeMode()).toBe('live');
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
