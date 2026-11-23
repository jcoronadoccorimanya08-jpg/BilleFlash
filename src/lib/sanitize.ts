/**
 * Valida todo lo que entra (lo que se lee de la bóveda, un respaldo o el archivo de inicio).
 * Lo que no sirve se descarta sin romper lo demás. Nunca se pierde un dato válido.
 */
import { DEFAULT_ACCOUNTS, DEFAULT_RATE } from './config';
import { isValidISODate } from './dates';
import { isAccent, isTextSize, isTheme } from './look';
import type { Account, AccountKind, AppState, Bill, CapitalShot, Currency, DayLog, Debt, DebtPayment, Expense, Income, Settings, Transfer } from './types';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 80): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const pos = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && n >= 0 ? n : null;
};
const time = (v: unknown): string => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : '12:00');
const currency = (v: unknown): Currency => (v === 'PEN' ? 'PEN' : 'BOB');
const KINDS: AccountKind[] = ['efectivo', 'banco', 'billetera', 'ahorro'];
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function slugId(text: string, taken: Iterable<string> = []): string {
  const used = new Set(taken);
  const base =
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'item';
  let id = base;
  for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
  return id;
}

export function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function sanitizeAccounts(v: unknown): Account[] {
  const out: Account[] = [];
  for (const a of arr(v)) {
    if (!isObj(a)) continue;
    const name = str(a.name, 40);
    const id = str(a.id, 40) || slugId(name, out.map((x) => x.id));
    if (!name || out.some((x) => x.id === id)) continue;
    out.push({ id, name, currency: currency(a.currency), kind: KINDS.includes(a.kind as AccountKind) ? (a.kind as AccountKind) : 'banco', balance: num(a.balance) ?? 0 });
  }
  return out;
}

function sanitizeExpenses(v: unknown, ids: Set<string>): Expense[] {
  const out: Expense[] = [];
  for (const e of arr(v)) {
    if (!isObj(e) || !isValidISODate(e.date) || !ids.has(str(e.accountId, 40))) continue;
    const amount = pos(e.amount);
    if (!amount) continue;
    out.push({ id: str(e.id, 40) || newId(), date: e.date, time: time(e.time), desc: str(e.desc, 60) || 'Gasto', amount, accountId: str(e.accountId, 40), ...(e.forgot === true ? { forgot: true } : {}) });
  }
  return out;
}

function sanitizeIncomes(v: unknown, ids: Set<string>): Income[] {
  const out: Income[] = [];
  for (const e of arr(v)) {
    if (!isObj(e) || !isValidISODate(e.date) || !ids.has(str(e.accountId, 40))) continue;
    const amount = pos(e.amount);
    if (!amount) continue;
    const q = isObj(e.quincena) ? { saving: pos(e.quincena.saving) ?? 0 } : undefined;
    out.push({ id: str(e.id, 40) || newId(), date: e.date, time: time(e.time), desc: str(e.desc, 60) || 'Ingreso', amount, accountId: str(e.accountId, 40), ...(q ? { quincena: q } : {}) });
  }
  return out;
}

function sanitizeTransfers(v: unknown, ids: Set<string>): Transfer[] {
  const out: Transfer[] = [];
  for (const t of arr(v)) {
    if (!isObj(t) || !isValidISODate(t.date)) continue;
    const from = str(t.from, 40);
    const to = str(t.to, 40);
    const amount = pos(t.amount);
    const received = pos(t.received);
    if (!ids.has(from) || !ids.has(to) || !amount || received === null) continue;
    out.push({ id: str(t.id, 40) || newId(), date: t.date, time: time(t.time), from, to, amount, received });
  }
  return out;
}

function sanitizeDays(v: unknown): Record<string, DayLog> {
  const out: Record<string, DayLog> = {};
  if (!isObj(v)) return out;
  for (const [k, d] of Object.entries(v)) {
    if (!isValidISODate(k) || !isObj(d)) continue;
    const at = typeof d.closedAt === 'string' && !Number.isNaN(Date.parse(d.closedAt)) ? d.closedAt : undefined;
    if (at) out[k] = { closedAt: at };
  }
  return out;
}

export function sanitizeDebts(v: unknown): Debt[] {
  const out: Debt[] = [];
  for (const d of arr(v)) {
    if (!isObj(d)) continue;
    const person = str(d.person, 40);
    const amount = pos(d.amount);
    if (!person || !amount) continue;
    const payments: DebtPayment[] = [];
    for (const p of arr(d.payments)) {
      if (!isObj(p) || !isValidISODate(p.date)) continue;
      const a = pos(p.amount);
      if (a) payments.push({ date: p.date, amount: a, ...(str(p.accountId, 40) ? { accountId: str(p.accountId, 40) } : {}) });
    }
    const plan =
      isObj(d.plan) && pos(d.plan.amount) && pos(d.plan.everyDays) && isValidISODate(d.plan.start)
        ? { amount: pos(d.plan.amount)!, everyDays: Math.max(1, Math.round(pos(d.plan.everyDays)!)), start: d.plan.start }
        : undefined;
    out.push({
      id: str(d.id, 40) || newId(),
      dir: d.dir === 'debo' ? 'debo' : 'me-deben',
      person,
      currency: currency(d.currency),
      amount,
      ...(str(d.note, 80) ? { note: str(d.note, 80) } : {}),
      ...(plan ? { plan } : {}),
      payments,
    });
  }
  return out;
}

export function sanitizeBills(v: unknown): Bill[] {
  const out: Bill[] = [];
  for (const b of arr(v)) {
    if (!isObj(b)) continue;
    const name = str(b.name, 40);
    if (!name) continue;
    const paid: Bill['paid'] = [];
    for (const p of arr(b.paid)) {
      if (isObj(p) && isValidISODate(p.date) && isValidISODate(p.due) && pos(p.amount) !== null)
        paid.push({ date: p.date, due: p.due, amount: pos(p.amount)!, ...(str(p.accountId, 40) ? { accountId: str(p.accountId, 40) } : {}) });
    }
    out.push({
      id: str(b.id, 40) || slugId(name, out.map((x) => x.id)),
      name,
      amount: pos(b.amount) ?? 0,
      currency: currency(b.currency),
      kind: b.kind === 'recibo' ? 'recibo' : 'mensual',
      ...(isValidISODate(b.nextDue) ? { nextDue: b.nextDue } : {}),
      source: b.source === 'depa' ? 'depa' : 'mio',
      paid,
    });
  }
  return out;
}

function sanitizeShots(v: unknown): CapitalShot[] {
  const out: CapitalShot[] = [];
  for (const s of arr(v)) {
    if (!isObj(s) || !isValidISODate(s.date)) continue;
    const [rate, enMano, meDeben, debo, capital] = [num(s.rate), num(s.enMano), num(s.meDeben), num(s.debo), num(s.capital)];
    if ([rate, enMano, meDeben, debo, capital].some((x) => x === null)) continue;
    out.push({ date: s.date, time: time(s.time), rate: rate!, enMano: enMano!, meDeben: meDeben!, debo: debo!, capital: capital! });
  }
  return out;
}

function sanitizeSettings(v: unknown): Settings | null {
  if (!isObj(v) || !isValidISODate(v.startDate)) return null;
  const q = isObj(v.quincena) ? v.quincena : {};
  const rate = pos(v.rate);
  return {
    startDate: v.startDate,
    rate: rate && rate > 0 ? rate : DEFAULT_RATE,
    quincena: { amount: pos(q.amount) ?? 0, saving: pos(q.saving) ?? 0, days: Math.max(1, Math.round(pos(q.days) ?? 15)) },
    carryStart: num(v.carryStart) ?? 0,
    ...(str(v.savingAccountId, 40) ? { savingAccountId: str(v.savingAccountId, 40) } : {}),
    discreet: v.discreet === true,
    ...(str(v.nick, 24) ? { nick: str(v.nick, 24) } : {}),
    theme: isTheme(v.theme) ? v.theme : 'system',
    ...(isAccent(v.accent) ? { accent: v.accent } : {}),
    ...(isTextSize(v.textSize) ? { textSize: v.textSize } : {}),
    autoLockMinutes: [0, 1, 5, 15].includes(v.autoLockMinutes as number) ? (v.autoLockMinutes as number) : 1,
    ...(typeof v.lastBackupAt === 'string' ? { lastBackupAt: v.lastBackupAt } : {}),
    createdAt: typeof v.createdAt === 'string' ? v.createdAt : new Date().toISOString(),
  };
}

export function sanitizeState(v: unknown): AppState | null {
  if (!isObj(v) || v.schema !== 1) return null;
  const settings = sanitizeSettings(v.settings);
  if (!settings) return null;
  const accounts = sanitizeAccounts(v.accounts);
  const list = accounts.length ? accounts : structuredClone(DEFAULT_ACCOUNTS);
  const ids = new Set(list.map((a) => a.id));
  if (settings.savingAccountId && !ids.has(settings.savingAccountId)) delete settings.savingAccountId;
  return {
    schema: 1,
    settings,
    accounts: list,
    expenses: sanitizeExpenses(v.expenses, ids),
    incomes: sanitizeIncomes(v.incomes, ids),
    transfers: sanitizeTransfers(v.transfers, ids),
    days: sanitizeDays(v.days),
    debts: sanitizeDebts(v.debts),
    bills: sanitizeBills(v.bills),
    shots: sanitizeShots(v.shots),
  };
}
