export type RuntimeMode = 'demo' | 'live';

export class DemoModeUnavailableError extends Error {
  constructor() {
    super(
      '[DemoModeUnavailableError]: demo mode is a development-only affordance and cannot be ' +
        'enabled in a production build.'
    );
    this.name = 'DemoModeUnavailableError';
  }
}

export class NotImplementedError extends Error {
  constructor(featureName: string) {
    super(`[NotImplementedError]: "${featureName}" is not implemented in 'live' mode. Switch runtime mode to 'demo' to run stubbed behavior.`);
    this.name = 'NotImplementedError';
  }
}

/**
 * Pure predicate for the demo-mode availability rule, so the production rule can be tested
 * without mutating the build environment. `setRuntimeMode` uses `isDemoModeAvailable()`,
 * which calls this with the real Vite env.
 */
export function canEnableDemoMode(env: { DEV: boolean }): boolean {
  return env.DEV;
}

/**
 * Demo mode is reachable only from a development build. `import.meta.env.DEV` is statically
 * replaced by Vite, so in a production bundle the condition folds to a constant and demo mode
 * can never be entered at runtime — not from the UI, not from the console.
 */
export function isDemoModeAvailable(): boolean {
  return canEnableDemoMode({ DEV: import.meta.env.DEV });
}

// INVARIANT: Default mode MUST ALWAYS be 'live' (Safe-by-default).
// Demo mode is strictly opt-in for visual UI previews.
let currentRuntimeMode: RuntimeMode = 'live';
const modeListeners: Set<(mode: RuntimeMode) => void> = new Set();

export function getRuntimeMode(): RuntimeMode {
  return currentRuntimeMode;
}

/**
 * Switches the runtime mode. Enabling demo mode where demo mode is unavailable is a
 * programming error, not a user action: it silently replaces every engine with fabricated
 * output, so it throws rather than degrading quietly.
 */
export function setRuntimeMode(mode: RuntimeMode): void {
  if (mode === 'demo' && !isDemoModeAvailable()) {
    throw new DemoModeUnavailableError();
  }
  currentRuntimeMode = mode;
  modeListeners.forEach((listener) => listener(currentRuntimeMode));
}

export function subscribeRuntimeMode(listener: (mode: RuntimeMode) => void): () => void {
  modeListeners.add(listener);
  return () => {
    modeListeners.delete(listener);
  };
}

export function isLiveMode(): boolean {
  return currentRuntimeMode === 'live';
}

export function isDemoMode(): boolean {
  return currentRuntimeMode === 'demo';
}
