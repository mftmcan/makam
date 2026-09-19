import type { Task } from '../../types';

export const EVIDENCE_TYPE_OPTIONS: { value: NonNullable<Task['evidenceType']>; label: string }[] = [
  { value: 'Link', label: 'Bağlantı' },
  { value: 'Image', label: 'Görsel' },
  { value: 'PDF', label: 'PDF' },
];

/**
 * KALICI KISIT (Spark planı): dosya tipi kanıt (Görsel/PDF) `storage.uploadBytes`
 * ile Cloud Storage'a yazar, ama `muftim` projesi 2024-10 sonrası açıldığından
 * Storage bucket'ı Blaze planı gerektirir (bkz. kök CLAUDE.md). MAKAM Spark
 * planında KALICI olarak kalacağından (proje kararı) bu bucket asla
 * oluşturulmayacak — dosya yükleme her zaman `uploadBytes` aşamasında
 * başarısız olur. Bu bayrak `false` iken Footer.tsx yalnızca "Bağlantı" (Link)
 * seçeneğini sunar; Görsel/PDF hiç render edilmez (jenerik bir hata mesajıyla
 * kullanıcıyı yanıltmak yerine).
 */
export const EVIDENCE_FILE_UPLOAD_ENABLED = false;

export const MAX_EVIDENCE_FILE_BYTES = 5 * 1024 * 1024; // storage.rules ile aynı sınır
