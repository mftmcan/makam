/**
 * E2E test verisi tohumlama script'i — yalnızca Firebase Emulator Suite'e
 * karşı çalışır (Admin SDK ile), gerçek üretim projesine hiçbir şekilde
 * dokunmaz. `firebase emulators:exec` içinden çağrılmalıdır (bkz.
 * package.json `test:e2e:emulator` script'i), çünkü emulator host
 * ortam değişkenlerini o komut otomatik olarak set eder.
 *
 * Bir Admin kullanıcısı ve örnek bir görev oluşturur, ardından Playwright'ın
 * gerçek Google OAuth popup'ını otomatikleştirmeye çalışmak yerine
 * kullanabileceği bir custom auth token üretip .e2e-token.json'a yazar.
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { writeFileSync } from 'fs';

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error(
    '[seedE2E] Emulator ortam değişkenleri bulunamadı. Bu script doğrudan değil, ' +
    '"npm run test:e2e:emulator" üzerinden (firebase emulators:exec ile) çalıştırılmalı.'
  );
  process.exit(1);
}

initializeApp({ projectId: 'muftim' });

const db = getFirestore();
const auth = getAuth();

const ADMIN_UID = 'e2e-admin-uid';
const ADMIN_EMAIL = 'admin@e2e.test';
const TASK_TITLE = 'E2E Test Görevi';

const DEPARTMENT_ID = 'Genel';

async function seed() {
  // Departman artık bir REFERANS VARLIKtır (bkz. firestore.rules
  // `departments`): görev dokümanlarının departmentId'si var olan bir
  // dokümana işaret etmek zorunda. Admin BİLİNÇLİ olarak departmansız kalır —
  // organizasyon geneli çalışır ve bu kuralca geçerlidir.
  await db.collection('departments').doc(DEPARTMENT_ID).set({
    name: DEPARTMENT_ID,
    createdAt: Date.now(),
    createdBy: ADMIN_UID,
  });

  await db.collection('users').doc(ADMIN_UID).set({
    uid: ADMIN_UID,
    fullName: 'E2E Test Admin',
    email: ADMIN_EMAIL,
    role: 'Admin',
  });

  const taskRef = db.collection('tasks').doc();
  const now = Date.now();
  await taskRef.set({
    id: taskRef.id,
    title: TASK_TITLE,
    description: 'seedE2E.ts tarafından oluşturuldu.',
    creatorId: ADMIN_UID,
    assigneeId: ADMIN_UID,
    status: 'ASSIGNED',
    priority: 'Medium',
    deadline: now + 7 * 24 * 60 * 60 * 1000,
    createdAt: now,
    updatedAt: now,
    lockVersion: 0,
    totalPausedTime: 0,
    departmentId: DEPARTMENT_ID,
  });

  const token = await auth.createCustomToken(ADMIN_UID);
  writeFileSync('.e2e-token.json', JSON.stringify({ token, taskTitle: TASK_TITLE, uid: ADMIN_UID }, null, 2));

  console.log(`[seedE2E] Admin (${ADMIN_EMAIL}) ve "${TASK_TITLE}" görevi oluşturuldu. Token .e2e-token.json içine yazıldı.`);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seedE2E] Hata:', err);
    process.exit(1);
  });
