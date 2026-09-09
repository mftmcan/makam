import React, { useState, useEffect, useRef } from 'react';
import { Info, Upload } from 'lucide-react';
import { Task, User as UserType, TaskStatus } from '../../types';
import { cn } from '../../lib/utils';
import { logger } from '../../lib/logger';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
import { storage, ref, uploadBytes, getDownloadURL } from '../../firebase';
import { getPrimaryAction } from './helpers';
import { EVIDENCE_TYPE_OPTIONS, MAX_EVIDENCE_FILE_BYTES } from './constants';

/* ── Modal Footer — Kalıcı Birincil Aksiyon + Kanıt Formu ─────────────────
   Tamamlama ile sonuçlanan geçişlerde (AWAITING_APPROVAL/COMPLETED) opsiyonel
   bir kanıt girişi (Bağlantı / Görsel / PDF) sunar; dosyalar storage.rules'un
   izin verdiği evidence/{taskId}/ yoluna yüklenir. Terminal aksiyonlarda
   "confirm-in-place" (ilk tıklamada onay isteyen buton) uygulanır. */
export const TaskDetailsFooter = ({ task, currentUser, onStatusChange }: {
  task: Task;
  currentUser: UserType | null;
  onStatusChange: (status: TaskStatus, evidence?: string, type?: Task['evidenceType']) => void;
}) => {
  const action = getPrimaryAction(task, currentUser);

  const [evidenceType, setEvidenceType] = useState<NonNullable<Task['evidenceType']>>('Link');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidenceError, setEvidenceError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmArmed, setConfirmArmed] = useState(false);
  const confirmTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Görev veya durum değişince formu sıfırla
  useEffect(() => {
    setEvidenceType('Link');
    setEvidenceUrl('');
    setEvidenceFile(null);
    setEvidenceError('');
    setConfirmArmed(false);
  }, [task.id, task.status]);

  useEffect(() => () => {
    if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
  }, []);

  if (!action) return null;

  const switchEvidenceType = (type: NonNullable<Task['evidenceType']>) => {
    setEvidenceType(type);
    setEvidenceFile(null);
    setEvidenceError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setEvidenceError('');
    if (!file) { setEvidenceFile(null); return; }
    const validType = evidenceType === 'PDF'
      ? file.type === 'application/pdf'
      : file.type.startsWith('image/');
    if (!validType) {
      setEvidenceFile(null);
      setEvidenceError(evidenceType === 'PDF' ? 'Yalnızca PDF dosyası yüklenebilir.' : 'Yalnızca görsel dosyası yüklenebilir.');
      e.target.value = '';
      return;
    }
    if (file.size >= MAX_EVIDENCE_FILE_BYTES) {
      setEvidenceFile(null);
      setEvidenceError('Dosya boyutu 5MB sınırını aşıyor.');
      e.target.value = '';
      return;
    }
    setEvidenceFile(file);
  };

  const execute = async () => {
    setIsSubmitting(true);
    setEvidenceError('');
    try {
      let evidence: string | undefined;
      let type: Task['evidenceType'] | undefined;
      if (action.collectsEvidence) {
        if (evidenceType === 'Link') {
          let url = evidenceUrl.trim();
          if (url && !/^\w+:\/\//.test(url)) url = `https://${url}`;
          if (url) { evidence = url; type = 'Link'; }
        } else if (evidenceFile) {
          const safeName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${evidenceFile.name.replace(/[^\w.\-]+/g, '_')}`;
          const storageRef = ref(storage, `evidence/${task.id}/${safeName}`);
          await uploadBytes(storageRef, evidenceFile);
          evidence = await getDownloadURL(storageRef);
          type = evidenceType;
        }
      }
      await Promise.resolve(onStatusChange(action.next, evidence, type));
    } catch (err) {
      logger.error('Evidence upload failed:', err);
      setEvidenceError('Kanıt yüklenemedi. Bağlantınızı kontrol edip tekrar deneyin.');
    } finally {
      setIsSubmitting(false);
      setConfirmArmed(false);
    }
  };

  const handleClick = () => {
    if (isSubmitting) return;
    if (action.needsConfirm && !confirmArmed) {
      setConfirmArmed(true);
      confirmTimerRef.current = window.setTimeout(() => setConfirmArmed(false), 4000);
      return;
    }
    if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
    execute();
  };

  return (
    <div className="flex flex-col md:flex-row md:items-end gap-4">
      {action.collectsEvidence && (
        <div className="flex flex-col gap-2 flex-1 min-w-0">
          <span className="text-micro font-medium text-text-muted uppercase tracking-caps inline-flex items-center gap-1.5">
            İcra Kanıtı <span className="normal-case tracking-normal font-light">(isteğe bağlı)</span>
            <Tooltip content="İşin nasıl tamamlandığını belgeler — denetim izlerinde ve olası itirazlarda referans olarak kullanılır.">
              <Info className="w-3 h-3 text-text-tertiary cursor-help" aria-label="Kanıt neden önemli" />
            </Tooltip>
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center bg-makam-glass border border-surface-border rounded-full p-0.5 shrink-0" role="group" aria-label="Kanıt türü">
              {EVIDENCE_TYPE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => switchEvidenceType(opt.value)}
                  aria-pressed={evidenceType === opt.value}
                  disabled={isSubmitting}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-micro font-medium uppercase tracking-widest transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue disabled:opacity-60',
                    evidenceType === opt.value
                      ? 'bg-executive-blue text-[color:var(--executive-blue-text)] shadow-sm'
                      : 'text-text-muted hover:text-executive-blue'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {evidenceType === 'Link' ? (
              <input
                type="url"
                value={evidenceUrl}
                onChange={(e) => setEvidenceUrl(e.target.value)}
                placeholder="https://... kanıt bağlantısı"
                aria-label="Kanıt bağlantısı"
                disabled={isSubmitting}
                className="flex-1 min-w-[180px] bg-makam-glass border border-makam-border/10 rounded-full px-4 py-2 text-body-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-executive-blue/15 disabled:opacity-60"
              />
            ) : (
              <>
                <input
                  ref={fileInputRef}
                  id="evidence-file-input"
                  type="file"
                  accept={evidenceType === 'PDF' ? 'application/pdf' : 'image/*'}
                  onChange={handleFileSelect}
                  disabled={isSubmitting}
                  className="sr-only"
                />
                <label
                  htmlFor="evidence-file-input"
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 bg-makam-glass border border-makam-border/10 rounded-full text-caption font-medium text-text-muted cursor-pointer',
                    'hover:text-executive-blue hover:border-executive-blue/20 transition-colors',
                    isSubmitting && 'opacity-60 pointer-events-none'
                  )}
                >
                  <Upload className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate max-w-[220px]">
                    {evidenceFile ? evidenceFile.name : 'Dosya Seç (maks. 5MB)'}
                  </span>
                </label>
              </>
            )}
          </div>
          {evidenceError && (
            <span role="alert" className="text-caption text-status-danger font-medium">{evidenceError}</span>
          )}
        </div>
      )}
      <Tooltip content={action.hint} className="w-full md:w-auto md:ml-auto shrink-0">
        <Button
          variant={action.variant}
          onClick={handleClick}
          isLoading={isSubmitting}
          className={cn(
            'h-12 text-micro tracking-widest w-full md:w-auto md:min-w-[240px]',
            confirmArmed && 'ring-2 ring-offset-2 ring-executive-gold animate-pulse'
          )}
        >
          {confirmArmed ? 'EMİN MİSİNİZ? ONAYLA' : action.label}
        </Button>
      </Tooltip>
    </div>
  );
};
