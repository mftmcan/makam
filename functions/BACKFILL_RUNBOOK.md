# Departman Taşıması — Üretim Rollout Runbook'u (P0-1 / P0-2)

Bu doküman, departman bazlı görünürlüğün iki P0 bulgusunu kapatan değişikliğin
**üretime alınma sırasını** tarif eder. Değişikliğin kendisi (kod + kurallar +
testler) hazırdır; burada anlatılan adımlar **elle** ve **bu sırayla**
uygulanmalıdır.

> **⚠️ EN ÖNEMLİ UYARI — SIRAYA UYULMAZSA VERİ GÖRÜNMEZ OLUR**
>
> Sıkılaştırılmış `tasks` okuma kuralı, backfill'den **ÖNCE** deploy edilirse
> `departmentId`'si eksik/null/boş olan **tüm mevcut görevler**, sorumlusu ve
> Admin dışındaki herkes için **anında görünmez olur**. Bu, üretimdeki
> görevlerin büyük bölümü olabilir: departman eskiden görevi *oluşturandan*
> türetiliyordu ve Admin'in departmanı tipik olarak boştur — yani
> **Admin'in oluşturduğu her görev departmansızdır.**
>
> Veri kaybı yaşanmaz (dokümanlar yerinde durur), ama Müdür/Memur panoları
> boşalır. Geri dönüş, eski kuralları yeniden deploy etmektir (bkz. "Geri alma").

---

## Neyi değiştiriyoruz?

| | Önce | Sonra |
|---|---|---|
| Görevin departmanı | Görevi **oluşturandan** türetilir, boş kalabilir | **Atanan kişiden** türetilir, **zorunlu** |
| Departmansız görev | `firestore.rules`'taki üç fallback yüzünden **tüm organizasyona açık** | Yalnızca Admin + sorumlu + aynı departman |
| Departman | Serbest metin, hiçbir yerde varlık değil | `departments/{id}` referans varlığı, `exists()` ile doğrulanır |
| Departman girişi | `<Input>` (yazım hatası → hayalet departman) | Kayıtlı birimlerden `<Select>` |

`departments` dokümanının **ID'si departmanın kendi string değeridir**
("Operasyon"). Bu, taşımanın taşıyıcı kararıdır: mevcut
`users.departmentId` / `tasks.departmentId` alanlarındaki **hiçbir değer
yeniden yazılmaz**, yalnızca karşılık gelen dokümanın var olması gerekir.

---

## Adım 0 — Ön kontroller

```bash
cd /c/Projem/makam
npm run lint && npm test && npm run test:rules && npm run eslint
cd functions && npm run build
```

Dördü de yeşil olmalı. `npm run test:rules` emulator gerektirir (Java 11+) ve
**gerçek projeye bağlanmaz**.

Ayrıca elinizde şunlar olmalı:
- Taşımayı tetikleyecek Admin kullanıcısının **UID**'si.
- Firestore'un güncel bir **yedeği** (Settings → Yedek Al ya da GCP export).

---

## Adım 1 — Kuralların BİRİNCİ AŞAMASI + backfill fonksiyonu

Bu aşamada `departments` koleksiyonu kuralları devreye girer, ama
**`tasks` okuma kuralındaki eski fallback'ler HENÜZ KALDIRILMAZ** ve
`departmentId` create'te **henüz zorunlu değildir**. Amaç: yeni koleksiyon
yazılabilir/okunabilir olsun, mevcut istemci ve mevcut veri hiç etkilenmesin.

### 1a. Geçici (birinci aşama) `firestore.rules` üret

```bash
cd /c/Projem/makam
# Değişiklik ÖNCESİ kural dosyasını geri al (bu faz öncesi son commit):
git show b6b4263:firestore.rules > firestore.rules
```

Ardından bu dosyaya **yalnızca aşağıdaki iki bloğu** ekleyin.

`isValidUser` fonksiyonundan hemen ÖNCE (Domain Validators bölümüne):

```
    function isValidDepartmentId(id) {
      return id is string && id.size() >= 1 && id.size() <= 100;
    }

    function isValidDepartment(data, departmentId) {
      let allowedFields = ['name', 'createdAt', 'createdBy'];
      return data.keys().hasAll(allowedFields) &&
             data.keys().hasOnly(allowedFields) &&
             data.name is string &&
             data.name == departmentId &&
             data.createdAt is number && data.createdAt > 0 &&
             data.createdBy is string && data.createdBy.size() <= 128;
    }
```

`match /tasks/{taskId}` bloğundan hemen ÖNCE:

```
    match /departments/{departmentId} {
      allow read: if isSignedIn();
      allow create: if isAdmin() && isValidDepartmentId(departmentId) && isValidDepartment(incoming(), departmentId);
      allow update: if isAdmin() && isValidDepartment(incoming(), departmentId) &&
                       incoming().createdAt == existing().createdAt &&
                       incoming().createdBy == existing().createdBy;
      allow delete: if false;
    }
```

### 1b. Deploy

```bash
firebase deploy --only firestore:rules
cd functions && npm run deploy   # backfillDepartments dahil tüm fonksiyonlar
```

> Bu repoda `firebase deploy` **hiçbir zaman otomatik çalıştırılmaz**; bu
> komutları bilinçli olarak siz çalıştırırsınız.

---

## Adım 2 — Backfill'i BİR KEZ çalıştır

`backfillDepartments` **idempotenttir**: iki kez çalıştırmak zarar vermez
(var olan departman yeniden yazılmaz, departmanı dolu görev güncellenmez).
Yine de bir kez çalıştırıp sonucu doğrulamak yeterlidir.

### Yöntem A — `firebase functions:shell` (önerilen)

```bash
cd /c/Projem/makam/functions
npm run shell
```

Shell açıldığında (Admin UID'nizi yazın):

```
backfillDepartments({}, { auth: { uid: 'GERCEK_ADMIN_UID', token: { admin: true } } })
```

> **DİKKAT:** `functions:shell` fonksiyonu **yerelde çalıştırır ama GERÇEK
> üretim Firestore'una yazar** (Admin SDK varsayılan kimlik bilgileriyle).
> Emulator'a karşı denemek isterseniz önce `firebase emulators:start --only firestore`
> çalıştırıp `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` ortam değişkenini verin.

### Yöntem B — Uygulama içinden (callable)

Admin olarak giriş yapmış bir oturumda, tarayıcı konsolundan `firebase/functions`
ile `httpsCallable(getFunctions(app, 'europe-west1'), 'backfillDepartments')`
çağrılabilir. Bu uygulama `firebase/functions` paketini bundle'a dahil
etmediğinden pratikte **Yöntem A tercih edilmelidir**.

### Beklenen çıktı

```json
{
  "departmentsCreated": 7,
  "departmentsExisting": 0,
  "tasksUpdated": 412,
  "tasksAlreadyValid": 88,
  "tasksFallenBackToDefault": 35,
  "skippedInvalidDepartmentNames": [],
  "unresolvedTaskIds": [],
  "durationMs": 4210
}
```

İki alanı mutlaka kontrol edin:

- **`skippedInvalidDepartmentNames` boş olmalı.** Dolu ise, o departman adları
  Firestore doküman ID'si olamıyor demektir (eğik çizgi içeriyor, `.`/`..` ya da
  `__x__` kalıbında). Bu kayıtlar **elle** düzeltilmeli: ilgili
  `users`/`tasks` dokümanlarındaki değeri geçerli bir ada çevirin ve backfill'i
  tekrar çalıştırın.
- **`unresolvedTaskIds` boş olmalı.** Dolu ise o görevlerin departmanı hâlâ
  atanamamıştır — Adım 4'e **geçmeyin**.

---

## Adım 3 — Doğrulama (Adım 4'ün ön koşulu)

`tasks` koleksiyonunda `departmentId`'si eksik/null/boş **hiçbir doküman
kalmadığını** doğrulayın. Firestore konsolu "alanı olmayan doküman" sorgusunu
yapamadığından aşağıdaki salt-okunur script kullanılır.

`scripts/verify-departments.mjs` olarak kaydedip çalıştırın:

```js
// SALT OKUNUR doğrulama — hiçbir şey yazmaz.
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ credential: applicationDefault(), projectId: 'muftim' });
const db = getFirestore();

const departments = new Set((await db.collection('departments').get()).docs.map(d => d.id));
const bad = [];
let cursor = null;
for (;;) {
  let q = db.collection('tasks').orderBy('__name__').limit(500);
  if (cursor) q = q.startAfter(cursor);
  const snap = await q.get();
  if (snap.empty) break;
  for (const doc of snap.docs) {
    const dept = doc.data().departmentId;
    if (dept === undefined || dept === null || dept === '') bad.push([doc.id, 'BOŞ']);
    else if (!departments.has(dept)) bad.push([doc.id, `HAYALET: ${dept}`]);
  }
  if (snap.docs.length < 500) break;
  cursor = snap.docs[snap.docs.length - 1];
}

console.log(`departments: ${departments.size} | sorunlu görev: ${bad.length}`);
bad.slice(0, 50).forEach(([id, why]) => console.log(`  ${id} -> ${why}`));
process.exit(bad.length === 0 ? 0 : 1);
```

```bash
cd /c/Projem/makam
GOOGLE_APPLICATION_CREDENTIALS=/yol/service-account.json node scripts/verify-departments.mjs
```

**Çıkış kodu 0 ve "sorunlu görev: 0" görmeden Adım 4'e GEÇMEYİN.**

Script iki şeyi birden kontrol eder: departmanı boş kalan görevler **ve**
var olmayan bir departmana işaret eden ("hayalet") görevler — ikincisi de
sıkılaştırılmış kural altında aynı sonucu doğurur (görev, sorumlusu dışında
kimseye görünmez).

---

## Adım 4 — İstemciyi deploy et (hosting)

```bash
cd /c/Projem/makam
npm run build
firebase deploy --only hosting
```

> **Bu, CI'daki normal sıranın TERSİDİR.** `.github/workflows/ci.yml` önce
> `firestore:rules` sonra `hosting` deploy eder. Bu taşımada istemci **önce**
> gitmelidir: yeni istemci her göreve gerçek bir `departmentId` yazar ve
> birinci aşama (gevşek) kurallar bunu zaten kabul eder. Ters sırada, henüz
> güncellenmemiş (tarayıcı önbelleğindeki) eski istemci `departmentId`
> göndermeden görev oluşturmaya çalışır ve sıkı kural bunu reddeder.

Deploy sonrası hızlı duman testi (Admin ile):
- Kadro ekranında "Departman / Birim" alanı bir **seçim listesi** olmalı ve
  Adım 2'de oluşturulan birimleri göstermeli.
- Bir Memur'a yeni talimat oluşturun → görev o Memur'un birimiyle kaydedilmeli.
- Bir Admin'e talimat oluşturmayı deneyin → "Sorumlu Birim" alanı görünmeli ve
  seçilmeden gönderim engellenmeli.

---

## Adım 5 — Kuralların İKİNCİ (nihai) AŞAMASI

Ancak Adım 3 doğrulandıktan ve Adım 4 tamamlandıktan sonra, bu repodaki
**nihai** `firestore.rules` deploy edilir:

```bash
cd /c/Projem/makam
git checkout firestore.rules      # Adım 1a'daki geçici sürümü at
firebase deploy --only firestore:rules
```

Bu deploy ile kapanan şeyler:
- `tasks` okuma kuralındaki üç "departmanı yoksa serbest" fallback'i,
- aynı üç fallback'in `taskGrantsAccess()` (blockers okuma/oluşturma,
  audit_logs oluşturma) ve `audit_logs` okuma kuralındaki kopyaları,
- `departmentId`'nin görev oluşturmada opsiyonel olması,
- görev/kullanıcı departmanının var olmayan bir birime işaret edebilmesi.

Deploy sonrası duman testi: **Admin olmayan** bir kullanıcıyla giriş yapıp
kendi biriminin görevlerini gördüğünü, başka birimin görevlerini görmediğini
doğrulayın.

---

## Geri alma

Her aşama bağımsız olarak geri alınabilir; **veri geri alınmaz ve
alınmasına gerek yoktur** (backfill yalnızca boş bir alanı doldurur, hiçbir
mevcut değeri değiştirmez).

| Sorun | Geri alma |
|---|---|
| Adım 5 sonrası görevler görünmüyor | `git show b6b4263:firestore.rules > firestore.rules && firebase deploy --only firestore:rules` (Adım 1a'daki gevşek sürüme dönün), sonra Adım 3'ü tekrar çalıştırıp eksiği bulun |
| Adım 4 sonrası istemcide sorun | Önceki hosting sürümüne dönün (Firebase Console → Hosting → sürüm geçmişi → geri al) |
| Backfill yanlış departman atadı | İlgili görevlerin `departmentId`'sini elle düzeltin; backfill yeniden çalıştırıldığında bunlara **dokunmaz** (departmanı dolu görevleri atlar) |

---

## Bilinen sınırlar / dikkat edilecekler

- **Departman silme kapalıdır** (`allow delete: if false`). Bir departman
  silinirse ona referans veren görev/kullanıcı yetim kalır ve o görevler
  sorumlusu dışında kimseye görünmez. Güvenli silme, referansların önce
  taşınmasını gerektirir — bu fazın kapsamı dışında.
- **Departman yeniden adlandırılamaz.** `name`, doküman ID'sine eşitlenmiştir;
  yeniden adlandırma, referans veren tüm `tasks`/`users` dokümanlarının
  yeniden yazılmasını gerektirir.
- **Eski yedeklerin geri yüklenmesi**: `restoreBackup`, taşımadan önce alınmış
  bir yedeği geri yüklerken artık kayıtlı olmayan bir departmana işaret eden
  kullanıcı kayıtları içerebilir. Kullanıcının departmanı **değişmiyorsa**
  kural bunu engellemez (`changed` kapısı), ama departman alanı da geri
  yazılıyorsa reddedilir. Böyle bir durumda eksik departmanı önce Kadro
  ekranından "+ Yeni Birim Oluştur" ile yaratın.
- **Admin departmansız kalabilir** ve bu bilinçlidir: Admin organizasyon geneli
  çalışır, tüm görevleri görür. Kurallar bu durumu açıkça geçerli sayar.
- Taşıma `updatedAt`/`lockVersion` alanlarına dokunmaz: `updatedAt` ilerletilse
  `scheduledDailyAudit`'in "24 saattir atıl" denetimi sıfırlanır ve tüm
  listelerde gerçek aktivite gizlenirdi; `lockVersion` artırılsa açık
  istemcilerde sahte `VERSION_MISMATCH` üretilirdi.
