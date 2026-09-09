import React, { useState, useEffect, useMemo } from 'react';
import { ShieldCheck, ArrowRight, Loader2, Info } from 'lucide-react';
import type { QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';
import { AuditLog, Task, User, TaskStatus } from '../types';
import type { AuditLogType } from '../types';
import { Button } from './ui/Button';
import { Avatar } from './ui/Avatar';
import { Badge } from './ui/Badge';
import { PageHeader } from './ui/PageHeader';
import { PageShell } from './ui/PageShell';
import { EmptyState } from './ui/EmptyState';
import { AuditLogListSkeleton } from './ui/Skeleton';
import { STATUS_LABELS, ROLE_LABELS, STATUS_BADGE_VARIANT } from '../constants';
import { formatDateTime } from '../lib/utils';
import { logger } from '../lib/logger';
import { auditLogService } from '../services/auditLogService';
import { useUIStore } from '../store/uiStore';
import { AUDIT_FIELD_LABELS, formatAuditValue } from '../lib/auditLabels';
import { cn } from '../lib/utils';

// Yetki-kritik alanlar: bir değişiklik bunlardan birini içeriyorsa satırın
// solunda Dashboard'un kriz şeridiyle AYNI görsel ağırlıkta bir uyarı şeridi
// gösterilir — bir rol/departman değişikliği ile bir açıklama düzeltmesi
// eskiden aynı görsel ağırlıktaydı (bkz. tasarım denetimi).
const SENSITIVE_AUDIT_FIELDS = new Set(['role', 'departmentId', 'email']);

interface AuditLogListProps {
  tasks: Task[];
  users: User[];
}

export const AuditLogList = ({ tasks, users }: AuditLogListProps) => {
  const addToast = useUIStore(state => state.addToast);
  const [logsState, setLogsState] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [lastVisibleDoc, setLastVisibleDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);

  // Filter States
  const [selectedUser, setSelectedUser] = useState<string>('ALL');
  const [selectedType, setSelectedType] = useState<'ALL' | AuditLogType>('ALL');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');

  // Aktör, İŞLEM TİPİ ve tarih aralığı filtrelerinin ÜÇÜ de sunucu tarafında
  // (Firestore sorgusu) uygulanır — yalnızca yüklenmiş sayfada arama yapmak,
  // henüz getirilmemiş eski kayıtları yanlışlıkla "kayıt yok" gibi göstererek
  // denetim aramalarını yanıltabilirdi. Tip filtresi eskiden TEK BAŞINA
  // istemcide kalmıştı: sunucudan gelen 15'lik sayfanın bir kısmı istemcide
  // elendiği için sayfa çoğu zaman 15'ten az satır gösteriyor, kullanıcı da
  // "Daha Fazla Yükle"ye tekrar tekrar basmak zorunda kalıyordu (bkz. kod
  // denetimi P2-22). Artık `logType` yazım anında kaydın kendisine yazılıyor
  // (bkz. taskService.auditLogType) ve burada `where` ile sorgulanıyor.
  const fetchLogs = async (isFirstLoad = false, cursor: QueryDocumentSnapshot<DocumentData> | null = null) => {
    if (loading) return;
    setLoading(true);
    try {
      // dateFrom saat eklenmeden parse edilirse UTC gece yarısı, dateTo saat
      // eklenerek parse edildiğinden YEREL saat sayılır — bu karışım TR
      // (UTC+3) için başlangıç gününün 00:00–02:59 aralığındaki kayıtları
      // sessizce filtreden düşürüyordu (bkz. kod denetimi). dateFrom'a da
      // AÇIKÇA yerel gece yarısı saati eklenir.
      const { logs: newLogs, lastDoc, hasMore: more } = await auditLogService.fetchFiltered({
        changedBy: selectedUser !== 'ALL' ? selectedUser : undefined,
        logType: selectedType !== 'ALL' ? selectedType : undefined,
        fromMs: dateFrom ? new Date(dateFrom + 'T00:00:00').getTime() : undefined,
        toMs: dateTo ? new Date(dateTo + 'T23:59:59.999').getTime() : undefined,
        pageSize: 15,
        cursor
      });

      if (isFirstLoad) {
        setLogsState(newLogs);
      } else {
        setLogsState(prev => [...prev, ...newLogs]);
      }

      setHasMore(more);
      if (more) setLastVisibleDoc(lastDoc);
    } catch (error) {
      logger.error('Error fetching audit logs:', error);
      addToast({ title: '⚠️ Denetim İzi Yüklenemedi', body: 'Kayıtlar getirilirken bir hata oluştu. Lütfen tekrar deneyin.', type: 'danger' });
    } finally {
      setLoading(false);
    }
  };

  // Aktör, işlem tipi veya tarih aralığı değiştiğinde sorguyu baştan başlat
  // (sayfalama sıfırlanır) — üçü de sunucu tarafı sorgu parametresi olduğundan
  // hepsi AYNI bağımlılık listesinde olmak zorunda.
  useEffect(() => {
    setLogsState([]);
    setLastVisibleDoc(null);
    setHasMore(true);
    fetchLogs(true, null);
  }, [selectedUser, selectedType, dateFrom, dateTo]);

  // "Daha Fazla Yükle" ile büyüyebilen log listesinde her satır için tasks/users
  // dizisinde O(n) find() yapmak yerine, tek geçişte kurulan O(1) Map lookup.
  const tasksById = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks]);
  const usersById = useMemo(() => new Map(users.map(u => [u.uid, u])), [users]);

  // NOT: burada eskiden bir `filteredLogs` useMemo'su vardı — tip filtresini
  // istemcide, kaydın ŞEKLİNDEN (`!log.changes && log.newValue !== undefined`)
  // tahmin ederek uyguluyordu. Kaldırıldı: sunucu artık zaten filtrelenmiş veri
  // döndürüyor (bkz. auditLogService.fetchFiltered), dolayısıyla `logsState`
  // doğrudan gösterilir. Bu, hem sayfalama tutarsızlığını hem de tahminin
  // kendi hatasını (bkz. taskService.auditLogType) ortadan kaldırır.

  // Diğer altı modülle AYNI disiplin: ilk yükleme genel bir spinner yerine
  // gerçek satır yapısını taklit eden bir iskelet gösterir (bkz. tasarım
  // denetimi — bu, o desenin eksik olduğu tek modüldü).
  if (loading && logsState.length === 0) return <AuditLogListSkeleton />;

  return (
    <PageShell>

      {/* ── Page header ─────────────────────────────────────────────── */}
      <PageHeader
        icon={ShieldCheck}
        title="DENETİM İZLERİ"
        // Eskiden "filtrelenen / yüklenen" biçiminde İKİ sayı vardı; istemci
        // tarafı eleme kalktığı için ikisi artık matematiksel olarak hep eşit
        // — tek sayı gösterilir.
        subtitle={`${logsState.length} Kayıt`}
        actions={<>
          {/* User Filter select */}
          <div className="flex items-center gap-2 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl px-3 py-2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-executive-blue has-[:focus-visible]:ring-offset-1">
            <Avatar size="xs" name="Filter" />
            <select
              value={selectedUser}
              onChange={e => setSelectedUser(e.target.value)}
              className="text-caption text-text-heading bg-transparent outline-none border-none cursor-pointer pr-4 font-medium"
              aria-label="Aktör Filtresi"
            >
              <option value="ALL" className="bg-surface-base text-text-heading">Tüm Aktörler</option>
              {users.map(u => (
                <option key={u.uid} value={u.uid} className="bg-surface-base text-text-heading">
                  {u.fullName}
                </option>
              ))}
            </select>
          </div>

          {/* Action Type filter select */}
          <div className="flex items-center gap-2 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl px-3 py-2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-executive-blue has-[:focus-visible]:ring-offset-1">
            <ShieldCheck className="w-3.5 h-3.5 text-executive-blue stroke-[1.5] flex-shrink-0" />
            <select
              value={selectedType}
              onChange={e => setSelectedType(e.target.value as 'ALL' | AuditLogType)}
              className="text-caption text-text-heading bg-transparent outline-none border-none cursor-pointer pr-4 font-medium"
              aria-label="İşlem Tipi Filtresi"
            >
              <option value="ALL" className="bg-surface-base text-text-heading">Tüm İşlemler</option>
              <option value="STATUS" className="bg-surface-base text-text-heading">Durum Değişiklikleri</option>
              <option value="FIELD" className="bg-surface-base text-text-heading">İçerik Güncellemeleri</option>
            </select>
          </div>

          {/* Date range filter */}
          <div className="flex items-center gap-1.5 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-2xl px-3 py-2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-executive-blue has-[:focus-visible]:ring-offset-1">
            <label htmlFor="audit-date-from" className="sr-only">Başlangıç Tarihi</label>
            <input
              id="audit-date-from"
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              max={dateTo || undefined}
              className="text-caption text-text-heading bg-transparent outline-none border-none cursor-pointer font-medium"
              aria-label="Başlangıç Tarihi"
            />
            <ArrowRight className="w-3 h-3 text-text-tertiary flex-shrink-0" />
            <label htmlFor="audit-date-to" className="sr-only">Bitiş Tarihi</label>
            <input
              id="audit-date-to"
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              min={dateFrom || undefined}
              className="text-caption text-text-heading bg-transparent outline-none border-none cursor-pointer font-medium"
              aria-label="Bitiş Tarihi"
            />
            {(dateFrom || dateTo) && (
              <button
                onClick={() => { setDateFrom(''); setDateTo(''); }}
                className="text-micro text-text-tertiary hover:text-executive-blue uppercase tracking-wider pl-1"
              >
                Temizle
              </button>
            )}
          </div>
        </>}
      />

      {/* Geriye dönük uyumluluk notu: `logType` yalnızca P2-22'den SONRA
          yazılan kayıtlarda var ve Firestore `where` eşitliği, alanı hiç
          taşımayan bir dokümanı asla eşleştirmez — bu yüzden tip filtresi
          seçiliyken daha eski kayıtlar sonuçlara hiç girmez. Backfill bilinçli
          olarak yapılmadı; bunu kullanıcıdan gizlemek, denetim izinde "kayıt
          yok" izlenimi vererek tam da sunucu-taraflı filtrelemeyle önlemeye
          çalıştığımız yanılgıyı üretirdi. */}
      {selectedType !== 'ALL' && (
        <div className="flex items-start gap-2 px-3 py-2 bg-executive-blue/[0.03] border border-executive-blue/[0.06] rounded-xl">
          <Info className="w-3 h-3 text-text-tertiary stroke-[1.5] flex-shrink-0 mt-[1px]" />
          <span className="text-micro text-text-tertiary tracking-label uppercase leading-relaxed">
            İşlem tipi filtresi yalnızca bu özelliğin eklenmesinden sonra yazılan kayıtları kapsar — daha eski kayıtlar için "Tüm İşlemler" seçin.
          </span>
        </div>
      )}

      <div className="flex flex-col gap-5">
        {logsState.length > 0 ? (
          logsState.map((log) => {
            // Öncelik sırası: (1) kaydın kendi donmuş `taskTitle`'ı — yeni
            // kayıtların tamamında vardır ve `tasks` dizisinin taskLimit
            // penceresinden BAĞIMSIZDIR, (2) bu alandan önce yazılmış eski
            // kayıtlar için yüklü görev listesindeki başlık, (3) ikisi de
            // yoksa "Bilinmeyen Talimat". Eskiden yalnızca (2) vardı, bu
            // yüzden pencere dışındaki her eski görev "Bilinmeyen Talimat"
            // görünüyordu (bkz. kod denetimi P1-14).
            const taskTitle = log.taskTitle ?? tasksById.get(log.taskId)?.title ?? 'Bilinmeyen Talimat';
            const user = usersById.get(log.changedBy);
            // Rol/departman/e-posta gibi yetki-kritik bir alan değişmişse, satır
            // Dashboard'un kriz şeridiyle AYNI görsel ağırlıkta işaretlenir — bir
            // rol yükseltmesi ile bir açıklama düzeltmesi artık aynı ağırlıkta
            // durmuyor (bkz. tasarım denetimi).
            const hasSensitiveChange = log.changes
              ? Object.keys(log.changes).some(field => SENSITIVE_AUDIT_FIELDS.has(field))
              : false;

            return (
              <div key={log.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 bg-makam-glass backdrop-blur-xl border border-surface-border rounded-xl group hover:bg-surface-elevated hover:shadow-sm transition-all relative overflow-hidden">
                <div className={cn(
                  'absolute top-0 left-0 h-full transition-all rounded-l-xl',
                  hasSensitiveChange ? 'w-[3px] bg-status-danger' : 'w-1 bg-executive-blue/10 group-hover:bg-executive-blue'
                )} />

                <div className="flex items-center gap-6 flex-1">
                  {/* Avatar */}
                  <Avatar
                    name={user?.fullName ?? 'Dizge'}
                    photoURL={user?.photoURL}
                    size="sm"
                  />
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-body-sm font-medium text-executive-blue tracking-tight group-hover:text-executive-blue transition-colors">{user?.fullName || 'Dizge'}</span>
                      <span className="text-micro text-text-tertiary font-medium uppercase tracking-label px-1.5 py-0.5 bg-surface-glass border border-surface-border rounded-md">{user ? ROLE_LABELS[user.role as keyof typeof ROLE_LABELS] : ''}</span>
                      {hasSensitiveChange && (
                        <span className="text-micro text-status-danger font-bold uppercase tracking-label px-1.5 py-0.5 bg-status-danger/10 border border-status-danger/20 rounded-md">Yetki Değişikliği</span>
                      )}
                    </div>
                    <span className="text-micro text-text-tertiary uppercase tracking-caps font-mono tabular-nums">{formatDateTime(log.timestamp)}</span>
                  </div>
                </div>

                <div className="flex flex-col gap-1 flex-[1.2] border-t sm:border-t-0 sm:border-l border-executive-blue/[0.04] pt-2.5 sm:pt-0 sm:pl-4">
                  <span className="text-micro text-text-tertiary font-medium uppercase tracking-caps">Operasyon Hedefi</span>
                  <span className="text-body-sm font-medium text-executive-blue truncate max-w-[280px] font-display">{taskTitle}</span>
                </div>

                <div className="flex flex-col gap-2 flex-[1.6] border-t sm:border-t-0 sm:border-l border-executive-blue/[0.04] pt-2.5 sm:pt-0 sm:pl-4">
                  <span className="text-micro text-text-tertiary font-medium uppercase tracking-caps">Durum Değişimi / Değer Detayı</span>
                  {log.changes ? (() => {
                    const visibleChanges = Object.entries(log.changes)
                      // Etiketi tanımlı olmayan alanlar (updatedAt, lockVersion gibi dahili
                      // teknik alanlar) kullanıcıya hiçbir zaman anlamlı gelmez — diff
                      // görünümünden tamamen gizlenir (bkz. kod denetimi).
                      .filter(([field]) => field in AUDIT_FIELD_LABELS)
                      // Değeri fiilen değişmeyen alanlar (ör. SORUMLU: Selim Deveci →
                      // Selim Deveci) diff'te kırmızı/yeşil gürültü yaratıp gerçek
                      // değişikliği gizliyordu (bkz. tasarım denetimi) — gösterilmez.
                      .filter(([field, diff]) => formatAuditValue(field, diff.old, users) !== formatAuditValue(field, diff.new, users));

                    if (visibleChanges.length === 0) {
                      return <span className="text-micro text-text-tertiary">Yalnızca üstveri güncellendi</span>;
                    }

                    return (
                      <div className="flex flex-col gap-1.5 w-full max-w-[340px]">
                        {visibleChanges.map(([field, diff]) => {
                          const fieldLabel = AUDIT_FIELD_LABELS[field] ?? field;

                          return (
                            <div key={field} className="flex flex-col gap-0.5 text-micro bg-executive-blue/[0.02] border border-executive-blue/[0.04] p-1.5 rounded-lg">
                              <span className="font-bold text-micro text-text-tertiary uppercase tracking-wider">{fieldLabel}</span>
                              <div className="flex items-center gap-1 text-micro text-text-muted font-mono">
                                <span className="line-through text-status-danger/70 truncate max-w-[120px]">{formatAuditValue(field, diff.old, users)}</span>
                                <ArrowRight className="w-2.5 h-2.5 flex-shrink-0" />
                                <span className="font-medium text-status-success truncate max-w-[120px]">{formatAuditValue(field, diff.new, users)}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })() : (
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={STATUS_BADGE_VARIANT[log.oldValue as TaskStatus] ?? 'default'}>
                        {STATUS_LABELS[log.oldValue as TaskStatus] || String(log.oldValue)}
                      </Badge>
                      <ArrowRight className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
                      <Badge variant={STATUS_BADGE_VARIANT[log.newValue as TaskStatus] ?? 'default'}>
                        {STATUS_LABELS[log.newValue as TaskStatus] || String(log.newValue)}
                      </Badge>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          !loading && (
            /* Eskiden burada ikinci bir dal vardı: "sayfa dolu ama istemci
               filtresinden hiçbiri geçmedi" durumu. Tip filtresi sunucuya
               taşındığı için bu durum artık OLUŞAMAZ (boş liste = sunucuda
               gerçekten eşleşen kayıt yok), dal da kaldırıldı — ölü bir
               koşul, okuyucuya var olmayan bir durumu anlatırdı. */
            <EmptyState
              size="lg"
              className="bg-surface-glass border-executive-blue/[0.05] gap-4"
              icon={<ShieldCheck className="w-10 h-10 stroke-[1]" />}
              message="Kayıt Bulunamadı"
            />
          )
        )}
      </div>

      {hasMore && logsState.length > 0 && (
        <div className="flex justify-center pt-4">
          <Button
            variant="secondary"
            onClick={() => fetchLogs(false, lastVisibleDoc)}
            disabled={loading}
            className="flex items-center gap-2 px-6 py-2 uppercase tracking-caps text-micro font-medium rounded-xl border border-surface-border bg-surface-elevated hover:bg-surface-glass transition-all"
          >
            {loading && <Loader2 className="w-3 h-3 animate-spin" />}
            Daha Fazla Yükle
          </Button>
        </div>
      )}

    </PageShell>
  );
};
