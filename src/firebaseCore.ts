import { initializeApp, FirebaseError } from 'firebase/app';
import {
  initializeAuth, GoogleAuthProvider, signInWithPopup as firebaseSignInWithPopup,
  signInWithCustomToken, signOut, onAuthStateChanged, connectAuthEmulator,
  indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence,
  browserPopupRedirectResolver,
} from 'firebase/auth';
import type { Auth, AuthProvider } from 'firebase/auth';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import firebaseConfigJson from '../firebase-applet-config.json';
import { logger } from './lib/logger';

const envDatabaseId = import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID;
const isSuspiciousEnv = envDatabaseId?.startsWith('http');
if (isSuspiciousEnv) logger.warn('Ignoring invalid Firebase environment overrides: database ID must not be a URL.');

const firebaseConfig = {
  ...firebaseConfigJson,
  apiKey: (!isSuspiciousEnv && import.meta.env.VITE_FIREBASE_API_KEY) || firebaseConfigJson.apiKey,
  authDomain: (!isSuspiciousEnv && import.meta.env.VITE_FIREBASE_AUTH_DOMAIN) || firebaseConfigJson.authDomain,
  projectId: (!isSuspiciousEnv && import.meta.env.VITE_FIREBASE_PROJECT_ID) || firebaseConfigJson.projectId,
  storageBucket: (!isSuspiciousEnv && import.meta.env.VITE_FIREBASE_STORAGE_BUCKET) || firebaseConfigJson.storageBucket,
  messagingSenderId: (!isSuspiciousEnv && import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID) || firebaseConfigJson.messagingSenderId,
  appId: (!isSuspiciousEnv && import.meta.env.VITE_FIREBASE_APP_ID) || firebaseConfigJson.appId,
  measurementId: (!isSuspiciousEnv && import.meta.env.VITE_FIREBASE_MEASUREMENT_ID) || firebaseConfigJson.measurementId,
};

export const databaseId = (!isSuspiciousEnv && envDatabaseId)
  || (firebaseConfigJson as Record<string, unknown>).firestoreDatabaseId as string | undefined
  || '(default)';
export const projectId = firebaseConfig.projectId;
export const app = initializeApp(firebaseConfig);

if (typeof window !== 'undefined' && import.meta.env.VITE_RECAPTCHA_SITE_KEY) {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(import.meta.env.VITE_RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
}

// Keep persisted sessions, but do not pre-open Google's popup/redirect iframe
// on mobile. The resolver is supplied only when the user actually signs in.
export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
});
export const googleProvider = new GoogleAuthProvider();
export function signInWithPopup(authInstance: Auth, provider: AuthProvider) {
  return firebaseSignInWithPopup(authInstance, provider, browserPopupRedirectResolver);
}

export const isUsingFirebaseEmulator = import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true';
if (isUsingFirebaseEmulator) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
}

export { signInWithCustomToken, signOut, onAuthStateChanged, FirebaseError };
