import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeAuth, signInWithPopup, browserPopupRedirectResolver } from 'firebase/auth';

vi.mock('firebase/app', async importOriginal => ({
  ...await importOriginal<typeof import('firebase/app')>(),
  initializeApp: vi.fn(() => ({ name: 'test-app' })),
}));
vi.mock('firebase/auth', () => ({
  initializeAuth: vi.fn(() => ({ currentUser: null })),
  GoogleAuthProvider: class {},
  indexedDBLocalPersistence: { type: 'LOCAL', kind: 'indexedDB' },
  browserLocalPersistence: { type: 'LOCAL', kind: 'localStorage' },
  browserSessionPersistence: { type: 'SESSION' },
  browserPopupRedirectResolver: { resolver: true },
  signInWithPopup: vi.fn().mockResolvedValue({ user: { uid: 'user-1' } }),
  signInWithCustomToken: vi.fn(), signOut: vi.fn(), onAuthStateChanged: vi.fn(), connectAuthEmulator: vi.fn(),
}));

beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

describe('lightweight auth initialization', () => {
  it('keeps persistence fallbacks without pre-initializing a popup iframe', async () => {
    await import('./firebaseCore');
    const options = vi.mocked(initializeAuth).mock.calls[0]![1]!;
    expect(options.persistence).toHaveLength(3);
    expect(options).not.toHaveProperty('popupRedirectResolver');
    expect(signInWithPopup).not.toHaveBeenCalled();
  });

  it('provides the popup resolver when an actual sign-in is requested', async () => {
    const core = await import('./firebaseCore');
    await core.signInWithPopup(core.auth, core.googleProvider);
    expect(signInWithPopup).toHaveBeenCalledWith(core.auth, core.googleProvider, browserPopupRedirectResolver);
  });
});
