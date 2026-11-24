/**
 * Respaldo cifrado como texto (.txt): Chrome en Android no comparte .json, pero sí .txt (Drive, WhatsApp, Archivos).
 * También lee el archivo de inicio (cuentas, deudas y pagos), que se carga desde el teléfono y nunca va al repositorio.
 */
import { todayISO } from './dates';
import { isWrapped } from './crypto';
import { DEFAULT_RATE } from './config';
import { sanitizeAccounts, sanitizeBills, sanitizeDebts, sanitizeGoals } from './sanitize';
import { isAccent } from './look';
import type { StartData } from './store';
import type { VaultRecord } from './vault';

const APP_ID = 'billeflash';
type BackupRecord = Pick<VaultRecord, 'v' | 'lock' | 'data'>;

export function backupFileName(): string {
  return `billeflash-${todayISO()}.txt`;
}

export function serializeBackup(record: BackupRecord): string {
  return JSON.stringify({ app: APP_ID, kind: 'backup', schema: 2, exportedAt: new Date().toISOString(), vault: record });
}

export type ConfigData = Omit<StartData, 'startDate'>;

export type ParsedFile = { kind: 'backup'; record: BackupRecord } | ({ kind: 'config' } & ConfigData);

/**
 * Lee el JSON de un archivo o de un texto pegado, tolerando lo que se cuela al copiar: caracteres invisibles,
 * texto antes o después de las llaves y, si con eso no basta, espacios raros y comillas tipográficas.
 * Si solo se pegó el nombre del archivo, lo dice con claridad.
 */
export function readLooseJSON(text: string, invalid: string): unknown {
  const clean = text.replace(/[\u200b-\u200d\u2060\ufeff]/g, '').trim();
  const a = clean.indexOf('{');
  const b = clean.lastIndexOf('}');
  if (a < 0 || b <= a) {
    if (/\.(txt|json)\s*\.*$/i.test(clean) || /configuraci[oó]n|respaldo/i.test(clean)) throw new Error('Pegaste solo el nombre del archivo. Copia todo su texto (empieza con «{») o elige el archivo con el botón de cargar.');
    throw new Error(invalid);
  }
  const body = clean.slice(a, b + 1);
  const spaces = body.replace(/[\u00a0\u2007\u202f]/g, ' ');
  // Primero tal cual; después con espacios normales; al final, también con comillas rectas.
  for (const candidate of [body, spaces, spaces.replace(/[\u201c-\u201f\u2033]/g, '"')]) {
    try {
      return JSON.parse(candidate);
    } catch {
      /* sigue con el siguiente intento */
    }
  }
  throw new Error(invalid);
}

/** Reconoce un respaldo cifrado o una configuración. Lanza un Error claro si no sirve. */
export function parseFile(text: string): ParsedFile {
  const o = readLooseJSON(text, 'El texto no es válido.') as Record<string, unknown> | null;
  if (!o || o.app !== APP_ID) throw new Error('Este archivo no es de BilleFlash.');
  if (o.kind === 'backup') {
    const v = o.vault as Partial<VaultRecord> | undefined;
    if (!v || v.v !== 2 || !isWrapped(v.data) || !v.lock?.pattern || !isWrapped(v.lock.pattern.wrapped)) {
      throw new Error('Este respaldo es de una versión anterior o está dañado.');
    }
    return { kind: 'backup', record: { v: 2, lock: { pattern: v.lock.pattern }, data: v.data } };
  }
  if (o.kind === 'config') {
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    const q = (o.quincena ?? {}) as Record<string, unknown>;
    const accounts = sanitizeAccounts(o.accounts);
    if (!accounts.length) throw new Error('El archivo de inicio no tiene cuentas.');
    return {
      kind: 'config',
      accounts,
      debts: sanitizeDebts(o.debts),
      bills: sanitizeBills(o.bills),
      rate: num(o.rate) && num(o.rate)! > 0 ? num(o.rate)! : DEFAULT_RATE,
      quincena: { amount: Math.max(0, num(q.amount) ?? 0), saving: Math.max(0, num(q.saving) ?? 0), days: Math.max(1, Math.round(num(q.days) ?? 15)) },
      carryStart: num(o.carryStart) ?? 0,
      ...(typeof o.nick === 'string' && o.nick.trim() ? { nick: o.nick.trim().slice(0, 24) } : {}),
      goals: sanitizeGoals(o.goals),
      ...(o.mainCurrency === 'PEN' ? { mainCurrency: 'PEN' as const } : {}),
      ...(o.incomeMode === 'libre' ? { incomeMode: 'libre' as const, dailyLimit: Math.max(0, num(o.dailyLimit) ?? 0), savingPct: Math.min(100, Math.max(0, num(o.savingPct) ?? 10)) } : {}),
      ...(isAccent(o.accent) ? { accent: o.accent } : {}),
      ...(typeof o.remindAt === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(o.remindAt) ? { remindAt: o.remindAt } : {}),
    };
  }
  throw new Error('Tipo de archivo desconocido.');
}

function textFile(text: string, name = backupFileName()): File {
  return new File([text], name, { type: 'text/plain' });
}

export function canShareFiles(): boolean {
  try {
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [textFile('{}')] });
  } catch {
    return false;
  }
}

export async function shareBackupText(text: string, name?: string): Promise<'shared' | 'cancelled'> {
  try {
    await navigator.share({ files: [textFile(text, name)], title: name ? 'BilleFlash' : 'Respaldo' });
    return 'shared';
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
    throw err;
  }
}

export function downloadBackupText(text: string, name?: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name ?? backupFileName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
