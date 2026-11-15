import { app, databaseId, isUsingFirebaseEmulator, projectId } from './firebaseCore';
export { auth, googleProvider, signInWithPopup, signInWithCustomToken, signOut, onAuthStateChanged, FirebaseError, databaseId, projectId, isUsingFirebaseEmulator } from './firebaseCore';
import { logger } from './lib/logger';
import { useUIStore } from './store/uiStore';
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, getCountFromServer, updateDoc, deleteDoc, onSnapshot, query, where, or, orderBy, limit, startAfter, documentId, addDoc, getDocFromServer, runTransaction, writeBatch, increment, connectFirestoreEmulator } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getMessaging, isSupported, type Messaging } from 'firebase/messaging';

export const db = getFirestore(app, databaseId);
export const storage = getStorage(app);

if (isUsingFirebaseEmulator) {
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
      logger.error("Current Project ID:", projectId);
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

export { collection, doc, setDoc, getDoc, getDocs, getCountFromServer, updateDoc, deleteDoc, onSnapshot, query, where, or, orderBy, limit, startAfter, documentId, addDoc, ref, uploadBytes, getDownloadURL, runTransaction, writeBatch, increment };
