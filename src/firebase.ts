import { initializeApp, FirebaseError } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithCustomToken, signOut, onAuthStateChanged, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, getCountFromServer, updateDoc, deleteDoc, onSnapshot, query, where, or, orderBy, limit, startAfter, documentId, addDoc, getDocFromServer, runTransaction, writeBatch, increment, connectFirestoreEmulator } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getMessaging, isSupported, type Messaging } from 'firebase/messaging';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import firebaseConfigJson from '../firebase-applet-config.json';
import { logger } from './lib/logger';
import { useUIStore } from './store/uiStore';

// Detect if environment variables are "suspicious" (e.g., databaseId is a URL)
const envDatabaseId = import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID;
const isSuspiciousEnv = envDatabaseId && envDatabaseId.startsWith('http');

if (isSuspiciousEnv) {
  logger.warn('CRITICAL NOTICE: Detected invalid Firebase environment variables (Database ID is a URL).');
  logger.warn('Ignoring VITE_FIREBASE_* environment variables and using firebase-applet-config.json instead.');
}

// Using firebase-applet-config.json as primary source, allowing env overrides ONLY if not suspicious
const firebaseConfig = {
  ...firebaseConfigJson,
  apiKey: (!isSuspiciousEnv && import.meta.env.VITE_FIREBASE_API_KEY) || firebaseConfigJson.apiKey,
  authDomain: (!isSuspiciousEnv && import.meta.env.VITE_FIREBASE_AUTH_DOMAIN) || firebaseConfigJson.authDomain,
  projectId: (!isSuspiciousEnv && import.meta.env.VITE_FIREBASE_PROJECT_ID) || firebaseConfigJson.projectId,
  storageBucket: (!isSuspiciousEnv && import.meta.env.VITE_FIREBASE_STORAGE_BUCKET) || firebaseConfigJson.storageBucket,
  messagingSenderId: (!isSuspiciousEnv && import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID) || firebaseConfigJson.messagingSenderId,
  appId: (!isSuspiciousEnv && import.meta.env.VITE_FIREBASE_APP_ID) || firebaseConfigJson.appId,
  measurementId: (!isSuspiciousEnv && import.meta.env.VITE_FIREBASE_MEASUREMENT_ID) || firebaseConfigJson.measurementId
};

const rawDatabaseId = (!isSuspiciousEnv && import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID) || (firebaseConfigJson as Record<string, unknown>).firestoreDatabaseId as string | undefined || '(default)';
const rawProjectId = firebaseConfig.projectId;

export const databaseId = rawDatabaseId;
export const projectId = rawProjectId;

const app = initializeApp(firebaseConfig);

// App Check Initialization (reCAPTCHA Enterprise)
if (typeof window !== 'undefined' && import.meta.env.VITE_RECAPTCHA_SITE_KEY) {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(import.meta.env.VITE_RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true
  });
}

export const auth = getAuth(app);
export const db = getFirestore(app, databaseId);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

// E2E/yerel geliştirme için Firebase Emulator Suite'e bağlanma.
// Yalnızca `vite dev` (import.meta.env.DEV) ile ve VITE_USE_FIREBASE_EMULATOR
// açıkça 'true' verildiğinde aktif olur — `vite build` çıktısında DEV her
// zaman false'a sabitlendiği için bu kod prod bundle'ında hiçbir zaman
// çalışamaz, ortam değişkeni yanlışlıkla kalsa bile.
export const isUsingFirebaseEmulator =
  import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true';

if (isUsingFirebaseEmulator) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  logger.debug('[Firebase] Emulator Suite\'e bağlanıldı (Auth :9099, Firestore :8080).');
}

export let messaging: Messaging | null = null;
isSupported().then((supported) => {
  if (supported) {
    messaging = getMessaging(app);
  }
});

// Test connection to Firestore
async function testConnection() {
  try {
    // Try to reach the server
    await getDocFromServer(doc(db, 'system', 'connection_test'));
    logger.debug('Firestore connection successful.');
  } catch (error) {
    const isReallyOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    if (error instanceof Error && error.message.includes('the client is offline') && !isReallyOffline) {
      // navigator.onLine === true iken Firestore'un "client is offline" demesi
      // gerçek bir yapılandırma sorununa işaret eder (yanlış databaseId/projectId
      // vb.). Tarayıcı GERÇEKTEN çevrimdışıysa (isReallyOffline) bu, offline-first
      // PWA'da beklenen/normal bir durumdur — o durumda yanıltıcı bir "yapılandırma
      // hatası" toastı GÖSTERİLMEZ (bkz. kod denetimi).
      logger.error("Firebase configuration error: Client is offline. Check your project settings.");
      logger.error("This usually means the databaseId or projectId is incorrect.");
      logger.error("Current Database ID:", databaseId);
      logger.error("Current Project ID:", firebaseConfig.projectId);
      logger.error("Please verify that your firestoreDatabaseId matches the one in Firebase Console.");
      // Bu hata daha önce yalnızca konsola yazılıyordu — yanlış databaseId/projectId
      // durumunda kullanıcı sebepsiz boş bir ekranla baş başa kalıyordu (Firestore
      // hiçbir zaman veri döndürmüyor ama görünürde hiçbir hata da yok). Artık
      // görünür bir toast ile de bildiriliyor ki en azından "bir şey bozuk"
      // sinyali kullanıcıya/desteğe ulaşsın.
      useUIStore.getState().addToast({
        title: '⚠️ Bağlantı Yapılandırma Hatası',
        body: 'Sunucuya bağlanılamıyor. Uygulama yapılandırması hatalı olabilir — lütfen sistem yöneticinize bildirin.',
        type: 'danger'
      });
    } else {
      // Other errors are fine, might just be a missing document
      logger.debug('Firestore connection test finished with:', error instanceof Error ? error.message : String(error));
    }
  }
}
// Uygulama başlangıcından hemen sonra çalıştırılırsa Firebase SDK'sının henüz
// tamamlanmamış iç kurulumuyla yarışıp yanlış negatif ("client is offline")
// üretebilir — bu gecikme değeri deneysel/tahminidir (yavaş ağlarda hâlâ
// yanlış negatif riski taşır), adlandırılmış bir sabite çıkarıldı ki en
// azından niyeti (ve ayarlanabilir tek nokta olduğu) açık olsun.
const CONNECTION_TEST_INITIAL_DELAY_MS = 2000;
setTimeout(testConnection, CONNECTION_TEST_INITIAL_DELAY_MS);

export { signInWithPopup, signInWithCustomToken, signOut, onAuthStateChanged, collection, doc, setDoc, getDoc, getDocs, getCountFromServer, updateDoc, deleteDoc, onSnapshot, query, where, or, orderBy, limit, startAfter, documentId, addDoc, ref, uploadBytes, getDownloadURL, runTransaction, writeBatch, increment, FirebaseError };
