import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import * as firebase from './firebase';
import { useUIStore } from './store/uiStore';

type AuthUser = { uid: string; email: string; photoURL?: string };
const session = vi.hoisted(() => ({
  auth: { currentUser: null as AuthUser | null },
  listener: null as ((user: AuthUser | null) => Promise<void>) | null,
  reset: vi.fn(),
}));

vi.mock('./firebaseCore', () => ({
  auth: session.auth,
  googleProvider: {},
  signInWithPopup: vi.fn(), signInWithCustomToken: vi.fn(), signOut: vi.fn(),
  isUsingFirebaseEmulator: false,
  onAuthStateChanged: vi.fn((_auth, listener) => { session.listener = listener; return vi.fn(); }),
}));
vi.mock('./store/dataStore', () => ({ useDataStore: { getState: () => ({ reset: session.reset }) } }));
vi.mock('./components/ReloadPrompt', () => ({ ReloadPrompt: () => null }));
vi.mock('./components/AuthenticatedApp', () => ({ AuthenticatedApp: () => <main>Doğrulanmış oturum</main> }));

beforeEach(() => {
  vi.clearAllMocks();
  session.listener = null;
  session.auth.currentUser = null;
  useUIStore.setState({ theme: 'light', toasts: [] });
  vi.mocked(firebase.doc).mockReturnValue({ id: 'user-1' } as any);
});

const renderApp = () => render(<MemoryRouter><App /></MemoryRouter>);

describe('auth profile loading', () => {
  it('signed-out login does not start a data listener', async () => {
    renderApp();
    await act(async () => { await session.listener!(null); });
    expect(screen.getByRole('button', { name: /KURUMSAL GİRİŞ YAP/i })).toBeVisible();
    expect(firebase.onSnapshot).not.toHaveBeenCalled();
    expect(session.reset).toHaveBeenCalledOnce();
  });

  it('sign-out while the data module loads cancels stale profile subscription', async () => {
    renderApp();
    const user = { uid: 'user-1', email: 'user@test.com' };
    await act(async () => {
      session.auth.currentUser = user;
      const pending = session.listener!(user);
      session.auth.currentUser = null;
      await session.listener!(null);
      await pending;
    });
    expect(firebase.onSnapshot).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /KURUMSAL GİRİŞ YAP/i })).toBeVisible();
  });

  it('a delayed photo write cannot restore a signed-out profile', async () => {
    let onProfile!: (snapshot: any) => Promise<void>;
    vi.mocked(firebase.onSnapshot).mockImplementation((_ref: any, callback: any) => { onProfile = callback; return vi.fn(); });
    let finishPhoto!: () => void;
    vi.mocked(firebase.updateDoc).mockImplementationOnce(() => new Promise<void>(resolve => { finishPhoto = resolve; }));
    renderApp();
    const user = { uid: 'user-1', email: 'user@test.com', photoURL: 'https://example.com/photo.png' };
    session.auth.currentUser = user;
    await act(async () => { await session.listener!(user); });
    let pendingProfile!: Promise<void>;
    await act(async () => {
      pendingProfile = onProfile({ exists: () => true, id: user.uid, data: () => ({ uid: user.uid, email: user.email, fullName: 'Test', role: 'Admin' }) });
      await vi.dynamicImportSettled();
    });
    await waitFor(() => expect(firebase.updateDoc).toHaveBeenCalledOnce());
    await act(async () => {
      session.auth.currentUser = null;
      await session.listener!(null);
      finishPhoto();
      await pendingProfile;
    });
    expect(screen.getByRole('button', { name: /KURUMSAL GİRİŞ YAP/i })).toBeVisible();
    expect(screen.queryByText('Doğrulanmış oturum')).not.toBeInTheDocument();
  });
});
