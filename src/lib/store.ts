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
import { afterPay, accountOf, allocateSaving, round2, shotOf } from './engine';
import { newId, sanitizeState } from './sanitize';
import type { Accent, Account, AppState, Bill, Category, Currency, Debt, Expense, Goal, Settings, TextSize } from './types';
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

const commitListeners = new Set<(s: AppState, remote: boolean) => void>();
let applyingRemote = false;

/** Avisa cada vez que se guarda algo de verdad (no en modo prueba). remote: vino de la nube. */
export function onCommit(cb: (s: AppState, remote: boolean) => void): () => void {
  commitListeners.add(cb);
  return () => commitListeners.delete(cb);
}

function commit(next: AppState) {
  set({ state: next });
  if (!snap.test) {
    void persist();
    for (const l of commitListeners) l(next, applyingRemote);
  }
}

/** Lo que llegó de tu otro dispositivo: se guarda aquí sin volver a subirlo. */
export function applyRemoteState(next: AppState) {
  if (snap.phase !== 'unlocked' || snap.test) return;
  applyingRemote = true;
  try {
    commit(next);
  } finally {
    applyingRemote = false;
  }
}

/** El estado real (null si está bloqueada o en modo prueba). */
export function realStateForSync(): AppState | null {
  return snap.phase === 'unlocked' && !snap.test ? snap.state : null;
}

/** Guarda (o quita) tu código de sincronización dentro de tus datos cifrados. */
export function setSyncCode(code: string | undefined) {
  if (!snap.state || snap.test) return;
  const settings = { ...snap.state.settings };
  if (code) settings.syncCode = code;
  else delete settings.syncCode;
  commit({ ...snap.state, settings });
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
  goals?: Goal[];
  nick?: string;
  mainCurrency?: Currency;
  incomeMode?: 'quincena' | 'libre';
  dailyLimit?: number;
  savingPct?: number;
  accent?: Accent;
  remindAt?: string;
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
    ...(o.mainCurrency === 'PEN' ? { mainCurrency: 'PEN' as Currency } : {}),
    ...(o.incomeMode === 'libre' ? { incomeMode: 'libre' as const, dailyLimit: o.dailyLimit ?? 0, savingPct: o.savingPct ?? 10 } : {}),
    ...(o.accent && o.accent !== 'verde' ? { accent: o.accent } : {}),
    ...(o.remindAt ? { remindAt: o.remindAt } : {}),
    theme: 'system',
    autoLockMinutes: 1,
    createdAt: new Date().toISOString(),
  };
  const st: AppState = { schema: 1, settings, accounts, expenses: [], incomes: [], transfers: [], days: {}, debts: o.debts ?? [], bills: o.bills ?? [], shots: [], goals: o.goals ?? [], team: [] };
  // Fila N° 1 de tu historial: cómo empiezas.
  return { ...st, shots: [shotOf(st, o.startDate, clockOf())] };
}

// ---------- Acciones ----------

function update(fn: (s: AppState) => AppState) {
  if (!snap.state) return;
  commit(fn(snap.state));
}
function updateSettings(fn: (s: Settings) => Settings) {
  update((st) => ({ ...st, settings: fn(st.settings) }));
}

function stripMain(g: Goal): Goal {
  if (g.main) return g;
  const { main: _m, ...rest } = g;
  void _m;
  return rest;
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
  category?: Category;
}

export const actions = {
  /** Anota un gasto. Si el día ya está cerrado, cuenta como olvidado. */
  addExpense(day: ISODate, e: ExpenseInput) {
    update((st) => {
      const forgot = Boolean(e.forgot || st.days[day]?.closedAt);
      const exp: Expense = { id: newId(), date: day, time: e.time ?? clockOf(), desc: e.desc.trim() || 'Gasto', amount: round2(e.amount), accountId: e.accountId, ...(forgot ? { forgot: true } : {}), ...(e.category ? { category: e.category } : {}) };
      return move({ ...st, expenses: [...st.expenses, exp] }, e.accountId, -exp.amount);
    });
  },

  updateExpense(id: string, patch: Partial<Pick<Expense, 'desc' | 'amount' | 'accountId' | 'time' | 'forgot' | 'category'>>) {
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
  addIncome(day: ISODate, i: { desc: string; amount: number; accountId: string; quincena?: boolean; /** Modo libre: false para no apartar nada esta vez. */ save?: boolean }) {
    update((st) => {
      const libre = st.settings.incomeMode === 'libre' && !i.quincena && i.save !== false;
      const saving = i.quincena ? Math.min(i.amount, st.settings.quincena.saving) : libre ? round2((i.amount * (st.settings.savingPct ?? 0)) / 100) : 0;
      const goals = saving > 0 ? allocateSaving(st.goals, saving, day, st.settings.quincena.days) : {};
      const box = { saving, ...(Object.keys(goals).length ? { goals } : {}) };
      const qz = i.quincena ? { quincena: box } : saving > 0 ? { kept: box } : {};
      const inc = { id: newId(), date: day, time: clockOf(), desc: i.desc.trim() || (i.quincena ? 'Quincena' : 'Ingreso'), amount: round2(i.amount), accountId: i.accountId, ...qz };
      let out = move({ ...st, incomes: [...st.incomes, inc], goals: st.goals.map((g) => (goals[g.id] ? { ...g, saved: round2(g.saved + goals[g.id]!) } : g)) }, i.accountId, inc.amount);
      const sid = st.settings.savingAccountId;
      if (saving > 0 && sid && sid !== i.accountId) {
        const from = accountOf(out, i.accountId);
        const to = accountOf(out, sid);
        if (from && to) out = move(move(out, from.id, -convert(saving, st.settings.mainCurrency ?? 'BOB', from.currency, st.settings.rate)), to.id, convert(saving, st.settings.mainCurrency ?? 'BOB', to.currency, st.settings.rate));
      }
      return out;
    });
  },

  deleteIncome(id: string) {
    update((st) => {
      const old = st.incomes.find((x) => x.id === id);
      if (!old) return st;
      const given = old.quincena?.goals ?? old.kept?.goals ?? {};
      let out = move({ ...st, incomes: st.incomes.filter((x) => x.id !== id), goals: st.goals.map((g) => (given[g.id] ? { ...g, saved: Math.max(0, round2(g.saved - given[g.id]!)) } : g)) }, old.accountId, -old.amount);
      const saving = old.quincena?.saving ?? old.kept?.saving ?? 0;
      const sid = st.settings.savingAccountId;
      const main = st.settings.mainCurrency ?? 'BOB';
      if (saving > 0 && sid && sid !== old.accountId) out = move(move(out, old.accountId, convert(saving, main, accountOf(out, old.accountId)?.currency ?? 'BOB', st.settings.rate)), sid, -convert(saving, main, accountOf(out, sid)?.currency ?? 'BOB', st.settings.rate));
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
      return { ...next, shots: [...st.shots, shot] };
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
  /** «Anotar mi capital ahora»: una foto más en tu historial, a cualquier hora. */
  snapshot(day: ISODate, now: Date = new Date()) {
    update((st) => ({ ...st, shots: [...st.shots, shotOf(st, day, clockOf(now))] }));
  },
  setUsdRate(rate: number | null) {
    updateSettings((s) => {
      const next = { ...s };
      if (rate && rate > 0) next.usdRate = round2(rate * 1000) / 1000;
      else delete next.usdRate;
      return next;
    });
  },
  setRate(rate: number) {
    if (rate > 0) updateSettings((s) => ({ ...s, rate: round2(rate * 1000) / 1000 }));
  },

  // ----- Metas de ahorro -----
  addGoal(g: Omit<Goal, 'id' | 'saved'>) {
    update((st) => {
      const main = g.main || st.goals.length === 0;
      const goal: Goal = { ...g, id: newId(), saved: 0, ...(main ? { main: true } : {}) };
      return { ...st, goals: [...st.goals.map((x) => (main ? { ...x, main: undefined } : x)).map(stripMain), goal] };
    });
  },
  updateGoal(id: string, patch: Partial<Pick<Goal, 'name' | 'target' | 'deadline'>>) {
    update((st) => ({
      ...st,
      goals: st.goals.map((g) => {
        if (g.id !== id) return g;
        const next = { ...g, ...patch };
        if ('deadline' in patch && !patch.deadline) delete next.deadline;
        return next;
      }),
    }));
  },
  setMainGoal(id: string) {
    update((st) => ({ ...st, goals: st.goals.map((g) => stripMain({ ...g, main: g.id === id ? true : undefined })) }));
  },
  /** Quita la meta: lo apartado vuelve a «sin asignar» dentro de tu ahorro. */
  deleteGoal(id: string) {
    update((st) => {
      const rest = st.goals.filter((g) => g.id !== id);
      if (rest.length && !rest.some((g) => g.main)) rest[0] = { ...rest[0]!, main: true };
      return { ...st, goals: rest };
    });
  },
  /**
   * Apartar para una meta. Desde otra cuenta, la plata pasa a tu ahorro; desde el ahorro mismo (o sin cuenta),
   * solo se asigna lo que ya tenías sin asignar.
   */
  addToGoal(id: string, day: ISODate, amount: number, fromAccountId?: string) {
    update((st) => {
      if (amount <= 0) return st;
      let out: AppState = { ...st, goals: st.goals.map((g) => (g.id === id ? { ...g, saved: round2(g.saved + amount) } : g)) };
      const sid = st.settings.savingAccountId;
      const from = accountOf(st, fromAccountId);
      const to = accountOf(st, sid);
      if (from && to && from.id !== to.id) {
        const out2 = convert(amount, st.settings.mainCurrency ?? 'BOB', from.currency, st.settings.rate);
        const t = { id: newId(), date: day, time: clockOf(), from: from.id, to: to.id, amount: out2, received: convert(amount, st.settings.mainCurrency ?? 'BOB', to.currency, st.settings.rate) };
        out = move(move({ ...out, transfers: [...out.transfers, t] }, from.id, -t.amount), to.id, t.received);
      }
      return out;
    });
  },
  /** Usar plata de una meta: baja lo apartado y, si eliges cuenta, pasa de tu ahorro a esa cuenta. */
  takeFromGoal(id: string, day: ISODate, amount: number, toAccountId?: string) {
    update((st) => {
      const g = st.goals.find((x) => x.id === id);
      if (!g || amount <= 0) return st;
      const n = Math.min(amount, g.saved);
      let out: AppState = { ...st, goals: st.goals.map((x) => (x.id === id ? { ...x, saved: round2(x.saved - n) } : x)) };
      const from = accountOf(st, st.settings.savingAccountId);
      const to = accountOf(st, toAccountId);
      if (from && to && from.id !== to.id) {
        const t = { id: newId(), date: day, time: clockOf(), from: from.id, to: to.id, amount: convert(n, st.settings.mainCurrency ?? 'BOB', from.currency, st.settings.rate), received: convert(n, st.settings.mainCurrency ?? 'BOB', to.currency, st.settings.rate) };
        out = move(move({ ...out, transfers: [...out.transfers, t] }, from.id, -t.amount), to.id, t.received);
      }
      return out;
    });
  },

  /** «Meter a la alcancía»: pasa plata a tu ahorro (y a tu meta principal, si tienes). */
  toPiggy(day: ISODate, amount: number, fromAccountId: string) {
    const st = snap.state;
    if (!st || amount <= 0) return;
    const main = st.goals.find((g) => g.main) ?? st.goals[0];
    if (main) {
      actions.addToGoal(main.id, day, amount, fromAccountId);
      return;
    }
    const from = accountOf(st, fromAccountId);
    const to = accountOf(st, st.settings.savingAccountId);
    if (from && to && from.id !== to.id) actions.transfer(day, from.id, to.id, convert(amount, st.settings.mainCurrency ?? 'BOB', from.currency, st.settings.rate), convert(amount, st.settings.mainCurrency ?? 'BOB', to.currency, st.settings.rate));
  },

  // ----- Modo entrenador -----
  setTeamCode(code: string) {
    updateSettings((s) => {
      const next = { ...s };
      if (code.trim()) next.teamCode = code.trim().slice(0, 40);
      else delete next.teamCode;
      return next;
    });
  },
  setCoachNote(note: { text: string; at: string } | null) {
    updateSettings((s) => {
      const next = { ...s };
      if (note) next.coachNote = note;
      else delete next.coachNote;
      return next;
    });
  },
  addMember(name: string, code: string) {
    update((st) => ({ ...st, team: [...st.team, { id: newId(), name: name.trim().slice(0, 40), code: code.trim().slice(0, 40) }] }));
  },
  removeMember(id: string) {
    update((st) => ({ ...st, team: st.team.filter((m) => m.id !== id) }));
  },
  saveMemberSummary(id: string, summary: unknown) {
    update((st) => ({ ...st, team: st.team.map((m) => (m.id === id ? { ...m, last: summary, lastAt: new Date().toISOString() } : m)) }));
  },
  setMoneyPrefs(p: { mainCurrency?: Currency; incomeMode?: 'quincena' | 'libre'; dailyLimit?: number; savingPct?: number; remindAt?: string }) {
    updateSettings((s) => {
      const next = { ...s, ...p };
      if (next.mainCurrency !== 'PEN') delete next.mainCurrency;
      if (next.incomeMode !== 'libre') delete next.incomeMode;
      return next;
    });
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
