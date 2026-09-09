importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: "AIzaSyAmuiLB8G0MapRfg0iNMGmnP79gXDbZLGo",
  authDomain: "makam-1453.firebaseapp.com",
  projectId: "makam-1453",
  storageBucket: "makam-1453.firebasestorage.app",
  messagingSenderId: "21497038615",
  appId: "1:21497038615:web:c89aa085cc60d069825952"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  
  const notificationTitle = payload.notification?.title || 'Makam Bildirimi';
  const notificationOptions = {
    body: payload.notification?.body || 'Yeni bir görev veya güncelleme var.',
    icon: '/vite.svg',
    badge: '/vite.svg',
    sound: 'default',
    vibrate: [200, 100, 200, 100, 300],
    data: payload.data
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  // Gerçek route /tasks/:taskId'dir (bkz. AppRoutes.tsx tabPath + alt-route
  // tanımı) — burada eskiden yanlışlıkla /gorevler/${taskId} kullanılıyordu,
  // bu path eşleşmediği için bildirime tıklayınca kullanıcı hep ana sayfaya
  // (catch-all) düşüyordu, görev detayı hiç açılmıyordu.
  const taskId = event.notification.data?.taskId;
  const targetUrl = taskId ? `/tasks/${taskId}` : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
