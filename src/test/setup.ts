import '@testing-library/jest-dom';
import { FirebaseError } from 'firebase/app';

// Firebase modüllerini mock'la — testlerde gerçek bağlantı gerekmez
vi.mock('../firebase', () => ({
  db: {},
  auth: { currentUser: null },
  collection: vi.fn(),
  doc: vi.fn(),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  setDoc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  getCountFromServer: vi.fn(),
  onSnapshot: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  or: vi.fn(),
  limit: vi.fn(),
  startAfter: vi.fn(),
  documentId: vi.fn(),
  writeBatch: vi.fn(() => ({
    update: vi.fn(),
    delete: vi.fn(),
    commit: vi.fn(),
  })),
  runTransaction: vi.fn(),
  increment: vi.fn(),
  messaging: null,
  FirebaseError,
}));

// localStorage mock
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Online/offline events
Object.defineProperty(window.navigator, 'onLine', { value: true, writable: true });

// window.dispatchEvent mock — sessizce geçelim
vi.spyOn(window, 'dispatchEvent').mockImplementation(() => true);
