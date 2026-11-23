/**
 * Estado de BilleFlash + bloqueo con patrón y huella.
 * Mientras la app está abierta, la llave de los datos vive solo en memoria. Cada cambio se cifra y se guarda al instante.
 */
import { useSyncExternalStore } from 'react';
import { biometricSupport, prfWithBiometric, registerBiometric } from './biometric';
import { APP_NAME, DEFAULT_ACCOUNTS, DEFAULT_RATE } from './config';
import {
  KDF_ITERATIONS,
  decryptBytes,
  decryptJSON,
  deriveKey,
  encryptBytes,
  encryptJSON,
  fromB64,
  importDataKey,
  keyFromPrf,
  newDataKey,
  randomBytes,
  toB64,
} from './crypto';
import { appDay, clockOf, type ISODate } from './dates';
import { afterPay, accountOf, round2, shotOf } from './engine';
import { newId, sanitizeState } from './sanitize';
import type { Accent, Account, AppState, Bill, Currency, Debt, Expense, Settings, TextSize } from './types';
import { deleteVault, readVault, requestPersistence, writeVault, type LockRecord, type VaultRecord } from './vault';

export type Phase = 'loading' | 'setup' | 'locked' | 'unlocked';

interface Snapshot {
  phase: Phase;
  state: AppState | null;
  hasBio: boolean;
  /** Modo prueba: una copia en memoria con fecha simulada. Nunca se guarda. */
  test: { date: ISODate } | null;
}

let snap: Snapshot = { phase: 'loading', state: null, hasBio: false, test: null };
/** Tus datos reales mientras estás en modo prueba (lo que se ve es una copia). */
let real: AppState | null = null;

/** El estado que se guarda: el real, aunque estés en modo prueba. */
function realState(): AppState | null {
  return snap.test ? real : snap.state;
}
let dkRaw: Uint8Array<ArrayBuffer> | null = null;
let dataKey: CryptoKey | null = null;
let lockRec: LockRecord | null = null;
let writing: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();
const errorListeners = new Set<(m: string) => void>();

function emit() {
  for (const l of listeners) l();
}
function set(next: Partial<Snapshot>) {
  snap = { ...snap, ...next };
  emit();
}

export function useStore(): Snapshot {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snap,
    () => snap,
  );
}

export function getState(): AppState | null {
  return snap.state;
}

export function onSaveError(cb: (m: string) => void): () => void {
  errorListeners.add(cb);
  return () => errorListeners.delete(cb);
}

function persist(): Promise<void> {
  writing = writing.then(async () => {
    const st = realState();
    if (!dataKey || !st || !lockRec) return;
    try {
      await writeVault({ v: 2, savedAt: Date.now(), lock: lockRec, data: await encryptJSON(dataKey, st) });
    } catch {
      for (const l of errorListeners) l('No se pudo guardar. Revisa el espacio del teléfono.');
    }
  });
  return writing;
}

export function flush(): Promise<void> {
  return writing;
}

function commit(next: AppState) {
  set({ state: next });
  if (!snap.test) void persist();
}

// ---------- Modo prueba ----------

/** Entra al modo prueba con una copia de tus datos y la fecha dada. Lo que marques no se guarda. */
export function enterTest(date: ISODate) {
  if (snap.phase !== 'unlocked' || !snap.state || snap.test) return;
  real = snap.state;
  set({ state: structuredClone(real), test: { date } });
}

export function setTestDate(date: ISODate) {
  if (snap.test) set({ test: { date } });
}

/** Sale del modo prueba: vuelven tus datos reales, intactos. */
export function exitTest() {
  if (!snap.test) return;
  const back = real;
  real = null;
  set({ state: back, test: null });
}

// ---------- Bóveda ----------

export async function initStore(): Promise<void> {
  const v = await readVault();
  lockRec = v?.lock ?? null;
  set({ phase: v ? 'locked' : 'setup', state: null, hasBio: Boolean(v?.lock.bio) });
}

async function patternLock(pattern: string, raw: Uint8Array<ArrayBuffer>) {
  const salt = randomBytes(16);
  const kek = await deriveKey(pattern, salt, KDF_ITERATIONS);
  return { iter: KDF_ITERATIONS, salt: toB64(salt), wrapped: await encryptBytes(kek, raw) };
}

async function openWith(raw: Uint8Array<ArrayBuffer>, record: Pick<VaultRecord, 'data'>): Promise<AppState | null> {
  const key = await importDataKey(raw);
  const state = sanitizeState(await decryptJSON(key, record.data));
  if (!state) return null;
  dkRaw = raw;
  dataKey = key;
  return state;
}

async function unwrapWithPattern(lock: LockRecord, pattern: string): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    return await decryptBytes(await deriveKey(pattern, fromB64(lock.pattern.salt), lock.pattern.iter), lock.pattern.wrapped);
  } catch {
    return null;
  }
}

export async function createVault(pattern: string, state: AppState): Promise<void> {
  const raw = newDataKey();
  dkRaw = raw;
  dataKey = await importDataKey(raw);
  lockRec = { pattern: await patternLock(pattern, raw) };
  set({ phase: 'unlocked', state, hasBio: false });
  await persist();
  void requestPersistence();
}

export async function unlockWithPattern(pattern: string): Promise<boolean> {
  const v = await readVault();
  if (!v) {
    set({ phase: 'setup' });
    return false;
  }
  const raw = await unwrapWithPattern(v.lock, pattern);
  if (!raw) return false;
  const state = await openWith(raw, v);
  if (!state) return false;
  lockRec = v.lock;
  set({ phase: 'unlocked', state, hasBio: Boolean(v.lock.bio) });
  return true;
}

export async function unlockWithBiometric(): Promise<'ok' | 'fail' | 'unavailable'> {
  const v = await readVault();
  const bio = v?.lock.bio;
  if (!v || !bio) return 'unavailable';
  try {
    const prf = await prfWithBiometric(bio.credId, bio.prfSalt);
    const state = await openWith(await decryptBytes(await keyFromPrf(prf), bio.wrapped), v);
    if (!state) return 'fail';
    lockRec = v.lock;
    set({ phase: 'unlocked', state, hasBio: true });
    return 'ok';
  } catch {
    return 'fail';
  }
}

export async function verifyPattern(pattern: string): Promise<boolean> {
  const v = await readVault();
  return Boolean(v && (await unwrapWithPattern(v.lock, pattern)));
}

export async function changePattern(pattern: string): Promise<void> {
  if (!dkRaw || !lockRec) return;
  await writing;
  lockRec = { ...lockRec, pattern: await patternLock(pattern, dkRaw) };
  await persist();
}

export { biometricSupport };

export async function enableBiometric(): Promise<void> {
  if (!dkRaw || !lockRec) throw new Error('LOCKED');
  const reg = await registerBiometric(APP_NAME);
  const wrapped = await encryptBytes(await keyFromPrf(reg.prfOutput), dkRaw);
  lockRec = { ...lockRec, bio: { credId: reg.credId, prfSalt: reg.prfSalt, wrapped } };
  set({ hasBio: true });
  await persist();
}

export async function disableBiometric(): Promise<void> {
  if (!lockRec) return;
  const { bio: _bio, ...rest } = lockRec;
  void _bio;
  lockRec = rest;
  set({ hasBio: false });
  await persist();
}

export function lock() {
  if (snap.phase !== 'unlocked') return;
  dkRaw = null;
  dataKey = null;
  real = null;
  set({ phase: 'locked', state: null, test: null });
}

export async function wipeAll(): Promise<void> {
  await writing;
  dkRaw = null;
  dataKey = null;
  lockRec = null;
  await deleteVault();
  real = null;
  set({ phase: 'setup', state: null, hasBio: false, test: null });
}

// ---------- Respaldo ----------

export async function currentBackup(): Promise<Omit<VaultRecord, 'savedAt'> | null> {
  const st = realState();
  if (!dataKey || !lockRec || !st) return null;
  await writing;
  return { v: 2, lock: { pattern: lockRec.pattern }, data: await encryptJSON(dataKey, st) };
}

export async function openBackup(record: Pick<VaultRecord, 'lock' | 'data'>, pattern: string): Promise<AppState | null> {
  const raw = await unwrapWithPattern(record.lock, pattern);
  if (!raw) return null;
  try {
    return sanitizeState(await decryptJSON(await importDataKey(raw), record.data));
  } catch {
    return null;
  }
}

export function replaceState(next: AppState) {
  commit(next);
}

// ---------- Estado inicial ----------

export interface StartData {
  startDate: ISODate;
  rate?: number;
  quincena?: Settings['quincena'];
  carryStart?: number;
  accounts?: Account[];
  debts?: Debt[];
  bills?: Bill[];
  nick?: string;
}

export function initialState(o: StartData): AppState {
  const accounts = o.accounts?.length ? o.accounts : structuredClone(DEFAULT_ACCOUNTS);
  const saving = accounts.find((a) => a.kind === 'ahorro');
  const settings: Settings = {
    startDate: o.startDate,
    rate: o.rate && o.rate > 0 ? o.rate : DEFAULT_RATE,
    quincena: o.quincena ?? { amount: 0, saving: 0, days: 15 },
    carryStart: o.carryStart ?? 0,
    ...(saving ? { savingAccountId: saving.id } : {}),
    discreet: false,
    ...(o.nick ? { nick: o.nick } : {}),
    theme: 'system',
    autoLockMinutes: 1,
    createdAt: new Date().toISOString(),
  };
  return { schema: 1, settings, accounts, expenses: [], incomes: [], transfers: [], days: {}, debts: o.debts ?? [], bills: o.bills ?? [], shots: [] };
}

// ---------- Acciones ----------

function update(fn: (s: AppState) => AppState) {
  if (!snap.state) return;
  commit(fn(snap.state));
}
function updateSettings(fn: (s: Settings) => Settings) {
  update((st) => ({ ...st, settings: fn(st.settings) }));
}

/** Pasa un monto de una moneda a otra con tu tipo de cambio. */
export function convert(amount: number, from: Currency, to: Currency, rate: number): number {
  if (from === to) return amount;
  return round2(from === 'PEN' ? amount * rate : amount / rate);
}

/** Suma (o resta) a una cuenta. */
function move(st: AppState, accountId: string | undefined, delta: number): AppState {
  if (!accountId || !delta) return st;
  return { ...st, accounts: st.accounts.map((a) => (a.id === accountId ? { ...a, balance: round2(a.balance + delta) } : a)) };
}

export interface ExpenseInput {
  desc: string;
  amount: number;
  accountId: string;
  time?: string;
  forgot?: boolean;
}

export const actions = {
  /** Anota un gasto. Si el día ya está cerrado, cuenta como olvidado. */
  addExpense(day: ISODate, e: ExpenseInput) {
    update((st) => {
      const forgot = Boolean(e.forgot || st.days[day]?.closedAt);
      const exp: Expense = { id: newId(), date: day, time: e.time ?? clockOf(), desc: e.desc.trim() || 'Gasto', amount: round2(e.amount), accountId: e.accountId, ...(forgot ? { forgot: true } : {}) };
      return move({ ...st, expenses: [...st.expenses, exp] }, e.accountId, -exp.amount);
    });
  },

  updateExpense(id: string, patch: Partial<Pick<Expense, 'desc' | 'amount' | 'accountId' | 'time' | 'forgot'>>) {
    update((st) => {
      const old = st.expenses.find((x) => x.id === id);
      if (!old) return st;
      const next: Expense = { ...old, ...patch, amount: round2(patch.amount ?? old.amount) };
      if (!next.forgot) delete next.forgot;
      // Un gasto agregado después de cerrar sigue siendo olvidado.
      if (st.days[old.date]?.closedAt && old.forgot && patch.forgot === false) next.forgot = true;
      let out = move(st, old.accountId, old.amount);
      out = move(out, next.accountId, -next.amount);
      return { ...out, expenses: out.expenses.map((x) => (x.id === id ? next : x)) };
    });
  },

  deleteExpense(id: string) {
    update((st) => {
      const old = st.expenses.find((x) => x.id === id);
      if (!old) return st;
      return move({ ...st, expenses: st.expenses.filter((x) => x.id !== id) }, old.accountId, old.amount);
    });
  },

  /** Entró plata. Si es la quincena, el ahorro se aparta solo a tu cuenta de ahorro. */
  addIncome(day: ISODate, i: { desc: string; amount: number; accountId: string; quincena?: boolean }) {
    update((st) => {
      const saving = i.quincena ? Math.min(i.amount, st.settings.quincena.saving) : 0;
      const inc = { id: newId(), date: day, time: clockOf(), desc: i.desc.trim() || (i.quincena ? 'Quincena' : 'Ingreso'), amount: round2(i.amount), accountId: i.accountId, ...(i.quincena ? { quincena: { saving } } : {}) };
      let out = move({ ...st, incomes: [...st.incomes, inc] }, i.accountId, inc.amount);
      const sid = st.settings.savingAccountId;
      if (saving > 0 && sid && sid !== i.accountId) {
        const from = accountOf(out, i.accountId);
        const to = accountOf(out, sid);
        if (from && to) out = move(move(out, from.id, -saving), to.id, convert(saving, 'BOB', to.currency, st.settings.rate));
      }
      return out;
    });
  },

  deleteIncome(id: string) {
    update((st) => {
      const old = st.incomes.find((x) => x.id === id);
      if (!old) return st;
      let out = move({ ...st, incomes: st.incomes.filter((x) => x.id !== id) }, old.accountId, -old.amount);
      const saving = old.quincena?.saving ?? 0;
      const sid = st.settings.savingAccountId;
      if (saving > 0 && sid && sid !== old.accountId) out = move(move(out, old.accountId, saving), sid, -convert(saving, 'BOB', accountOf(out, sid)?.currency ?? 'BOB', st.settings.rate));
      return out;
    });
  },

  /** Pasa plata de una cuenta a otra (con el cambio si son monedas distintas). */
  transfer(day: ISODate, from: string, to: string, amount: number, received: number) {
    update((st) => {
      if (from === to || amount <= 0) return st;
      const t = { id: newId(), date: day, time: clockOf(), from, to, amount: round2(amount), received: round2(received) };
      return move(move({ ...st, transfers: [...st.transfers, t] }, from, -t.amount), to, t.received);
    });
  },

  /** «Cerrar mi día»: sube la racha y guarda la foto de tu capital. */
  closeDay(day: ISODate, now: Date = new Date()) {
    update((st) => {
      if (st.days[day]?.closedAt || day !== appDay(now)) return st;
      const next = { ...st, days: { ...st.days, [day]: { closedAt: now.toISOString() } } };
      const shot = shotOf(next, day, clockOf(now));
      return { ...next, shots: [...st.shots.filter((s) => s.date !== day), shot] };
    });
  },

  // ----- Cuentas -----
  addAccount(a: Omit<Account, 'id'>) {
    update((st) => ({ ...st, accounts: [...st.accounts, { ...a, id: newId(), balance: round2(a.balance) }] }));
  },
  updateAccount(id: string, patch: Partial<Pick<Account, 'name' | 'kind'>>) {
    update((st) => ({ ...st, accounts: st.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
  },
  /** Cuadrar: escribes lo que de verdad tienes en esa cuenta. */
  setBalance(id: string, balance: number) {
    update((st) => ({ ...st, accounts: st.accounts.map((a) => (a.id === id ? { ...a, balance: round2(balance) } : a)) }));
  },
  /** Solo se puede quitar una cuenta sin movimientos y en cero. */
  removeAccount(id: string) {
    update((st) => {
      const used = st.expenses.some((e) => e.accountId === id) || st.incomes.some((e) => e.accountId === id) || st.transfers.some((t) => t.from === id || t.to === id);
      const acc = accountOf(st, id);
      if (used || !acc || acc.balance !== 0 || st.accounts.length <= 1) return st;
      return { ...st, accounts: st.accounts.filter((a) => a.id !== id) };
    });
  },
  setRate(rate: number) {
    if (rate > 0) updateSettings((s) => ({ ...s, rate: round2(rate * 1000) / 1000 }));
  },

  // ----- Deudas -----
  addDebt(d: Omit<Debt, 'id' | 'payments'>) {
    update((st) => ({ ...st, debts: [...st.debts, { ...d, id: newId(), payments: [] }] }));
  },
  updateDebt(id: string, patch: Partial<Omit<Debt, 'id' | 'payments'>>) {
    update((st) => ({
      ...st,
      debts: st.debts.map((d) => {
        if (d.id !== id) return d;
        const next = { ...d, ...patch };
        if (patch.plan === undefined && 'plan' in patch) delete next.plan;
        return next;
      }),
    }));
  },
  deleteDebt(id: string) {
    update((st) => ({ ...st, debts: st.debts.filter((d) => d.id !== id) }));
  },
  /** Un pago de una deuda: si te pagan, entra a tu cuenta; si pagas, sale de ella. */
  payDebt(id: string, day: ISODate, amount: number, accountId?: string) {
    update((st) => {
      const d = st.debts.find((x) => x.id === id);
      if (!d || amount <= 0) return st;
      const out = { ...st, debts: st.debts.map((x) => (x.id === id ? { ...x, payments: [...x.payments, { date: day, amount: round2(amount), ...(accountId ? { accountId } : {}) }] } : x)) };
      const acc = accountOf(st, accountId);
      if (!acc) return out;
      const inAcc = convert(amount, d.currency, acc.currency, st.settings.rate);
      return move(out, acc.id, d.dir === 'me-deben' ? inAcc : -inAcc);
    });
  },

  // ----- Pagos que se repiten -----
  addBill(b: Omit<Bill, 'id' | 'paid'>) {
    update((st) => ({ ...st, bills: [...st.bills, { ...b, id: newId(), paid: [] }] }));
  },
  updateBill(id: string, patch: Partial<Omit<Bill, 'id' | 'paid'>>) {
    update((st) => ({
      ...st,
      bills: st.bills.map((b) => {
        if (b.id !== id) return b;
        const next = { ...b, ...patch };
        if ('nextDue' in patch && !patch.nextDue) delete next.nextDue;
        return next;
      }),
    }));
  },
  deleteBill(id: string) {
    update((st) => ({ ...st, bills: st.bills.filter((b) => b.id !== id) }));
  },
  /** Pagas el vencimiento más antiguo. Si sale de tus cuentas, se descuenta. */
  payBill(id: string, day: ISODate, amount: number, accountId?: string) {
    update((st) => {
      const b = st.bills.find((x) => x.id === id);
      if (!b?.nextDue) return st;
      const nextDue = afterPay(b);
      const paidRow = { date: day, due: b.nextDue, amount: round2(amount), ...(accountId ? { accountId } : {}) };
      const nb: Bill = { ...b, paid: [...b.paid, paidRow] };
      if (nextDue) nb.nextDue = nextDue;
      else delete nb.nextDue;
      const out = { ...st, bills: st.bills.map((x) => (x.id === id ? nb : x)) };
      const acc = accountOf(st, accountId);
      return acc ? move(out, acc.id, -convert(amount, b.currency, acc.currency, st.settings.rate)) : out;
    });
  },

  // ----- Ajustes -----
  setQuincena(q: Settings['quincena']) {
    updateSettings((s) => ({ ...s, quincena: q }));
  },
  setCarryStart(n: number) {
    updateSettings((s) => ({ ...s, carryStart: round2(n) }));
  },
  setSavingAccount(id: string) {
    updateSettings((s) => ({ ...s, savingAccountId: id }));
  },
  setDiscreet(on: boolean) {
    updateSettings((s) => ({ ...s, discreet: on }));
  },
  setNick(nick: string) {
    updateSettings((s) => {
      const next = { ...s };
      if (nick.trim()) next.nick = nick.trim().slice(0, 24);
      else delete next.nick;
      return next;
    });
  },
  setStartDate(startDate: ISODate) {
    updateSettings((s) => ({ ...s, startDate }));
  },
  setTheme(theme: Settings['theme']) {
    updateSettings((s) => ({ ...s, theme }));
  },
  setAccent(accent: Accent) {
    updateSettings((s) => {
      const next = { ...s };
      if (accent === 'verde') delete next.accent;
      else next.accent = accent;
      return next;
    });
  },
  setTextSize(size: TextSize) {
    updateSettings((s) => {
      const next = { ...s };
      if (size === 'normal') delete next.textSize;
      else next.textSize = size;
      return next;
    });
  },
  setAutoLock(minutes: number) {
    updateSettings((s) => ({ ...s, autoLockMinutes: minutes }));
  },
  markBackup() {
    updateSettings((s) => ({ ...s, lastBackupAt: new Date().toISOString() }));
  },
};
