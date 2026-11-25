/**
 * «Movimientos»: todo lo que entró y salió de tus cuentas, en orden, con de dónde salió y a dónde entró.
 * Se arma con lo que ya está guardado (gastos, ingresos, mover plata, pagos fijos, deudas y cuadres): no se
 * guarda nada nuevo. Cada movimiento sabe cómo deshacerse.
 */
import { CATEGORIES, categoryOf } from './engine';
import { formatShort, type ISODate } from './dates';
import type { AppState, Currency } from './types';

export type MoveKind = 'gasto' | 'ingreso' | 'mover' | 'pago' | 'deuda' | 'cobro' | 'ajuste';

export type UndoRef =
  | { type: 'expense'; id: string }
  | { type: 'income'; id: string }
  | { type: 'transfer'; id: string }
  | { type: 'bill'; billId: string; index: number }
  | { type: 'debt'; debtId: string; index: number }
  | { type: 'adjust'; id: string };

export interface MoveLine {
  accountId: string;
  /** En la moneda de esa cuenta: + entró, − salió. */
  amount: number;
}

export interface Movement {
  key: string;
  kind: MoveKind;
  date: ISODate;
  /** «HH:MM» (vacío en pagos anteriores a la 1.7). */
  time: string;
  title: string;
  detail: string;
  /** Monto principal (+ entró, − salió; en «mover», lo que salió). */
  amount: number;
  currency: Currency;
  /** Cómo cambió cada cuenta. Vacío: no pasó por tus cuentas. */
  lines: MoveLine[];
  undo: UndoRef;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
function conv(amount: number, from: Currency, to: Currency, rate: number): number {
  if (from === to) return amount;
  return round2(from === 'PEN' ? amount * rate : amount / rate);
}

export const KIND_ICON: Record<MoveKind, string> = { gasto: '🛒', ingreso: '💵', mover: '🔁', pago: '📌', deuda: '🤝', cobro: '🤝', ajuste: '✏️' };

export function movements(state: AppState): Movement[] {
  const rate = state.settings.rate;
  const acc = (id?: string) => state.accounts.find((a) => a.id === id);
  const name = (id?: string) => acc(id)?.name ?? 'cuenta quitada';
  const main: Currency = state.settings.mainCurrency ?? 'BOB';
  const out: Movement[] = [];

  for (const e of state.expenses) {
    const a = acc(e.accountId);
    const cat = CATEGORIES.find((c) => c.id === categoryOf(e))?.label ?? 'Otros';
    out.push({ key: `e-${e.id}`, kind: 'gasto', date: e.date, time: e.time, title: e.desc, detail: `${cat} · ${name(e.accountId)}${e.forgot ? ' · olvidado' : ''}`, amount: -e.amount, currency: a?.currency ?? 'BOB', lines: [{ accountId: e.accountId, amount: -e.amount }], undo: { type: 'expense', id: e.id } });
  }

  for (const i of state.incomes) {
    const a = acc(i.accountId);
    const lines: MoveLine[] = [{ accountId: i.accountId, amount: i.amount }];
    const saving = i.quincena?.saving ?? i.kept?.saving ?? 0;
    const sid = state.settings.savingAccountId;
    const s = acc(sid);
    if (saving > 0 && s && a && s.id !== a.id) {
      lines.push({ accountId: a.id, amount: -conv(saving, main, a.currency, rate) }, { accountId: s.id, amount: conv(saving, main, s.currency, rate) });
    }
    const tag = i.quincena ? 'Quincena' : 'Entró plata';
    out.push({
      key: `i-${i.id}`,
      kind: 'ingreso',
      date: i.date,
      time: i.time,
      title: i.desc,
      detail: `${tag} · a ${name(i.accountId)}${saving > 0 ? ` · ${round2(saving)} al ahorro` : ''}`,
      amount: i.amount,
      currency: a?.currency ?? 'BOB',
      lines,
      undo: { type: 'income', id: i.id },
    });
  }

  for (const t of state.transfers) {
    const a = acc(t.from);
    out.push({ key: `t-${t.id}`, kind: 'mover', date: t.date, time: t.time, title: t.to === state.settings.savingAccountId ? 'Al ahorro' : 'Mover plata', detail: `${name(t.from)} → ${name(t.to)}`, amount: t.amount, currency: a?.currency ?? 'BOB', lines: [{ accountId: t.from, amount: -t.amount }, { accountId: t.to, amount: t.received }], undo: { type: 'transfer', id: t.id } });
  }

  for (const b of state.bills) {
    b.paid.forEach((p, index) => {
      const a = acc(p.accountId);
      const months = p.months ?? 1;
      const where = a ? name(p.accountId) : b.source === 'depa' ? 'plata del depa' : 'no pasó por tus cuentas';
      out.push({
        key: `b-${b.id}-${index}`,
        kind: 'pago',
        date: p.date,
        time: p.time ?? '',
        title: `${b.name}${months > 1 ? ` (${months} meses)` : ''}`,
        detail: `Pago fijo · ${where}${b.kind === 'mensual' ? ` · ${months > 1 ? 'desde el mes' : 'mes'} del ${formatShort(p.due)}` : ''}`,
        amount: -p.amount,
        currency: b.currency,
        lines: a ? [{ accountId: a.id, amount: -conv(p.amount, b.currency, a.currency, rate) }] : [],
        undo: { type: 'bill', billId: b.id, index },
      });
    });
  }

  for (const d of state.debts) {
    d.payments.forEach((p, index) => {
      const a = acc(p.accountId);
      const sign = d.dir === 'me-deben' ? 1 : -1;
      out.push({
        key: `d-${d.id}-${index}`,
        kind: d.dir === 'me-deben' ? 'cobro' : 'deuda',
        date: p.date,
        time: p.time ?? '',
        title: d.dir === 'me-deben' ? `${d.person} te pagó` : `Pagaste a ${d.person}`,
        detail: `Deuda · ${a ? name(p.accountId) : 'no pasó por tus cuentas'}`,
        amount: sign * p.amount,
        currency: d.currency,
        lines: a ? [{ accountId: a.id, amount: sign * conv(p.amount, d.currency, a.currency, rate) }] : [],
        undo: { type: 'debt', debtId: d.id, index },
      });
    });
  }

  for (const j of state.adjusts ?? []) {
    const a = acc(j.accountId);
    out.push({ key: `a-${j.id}`, kind: 'ajuste', date: j.date, time: j.time, title: 'Cuadre a mano', detail: `${name(j.accountId)} · escribiste el saldo real`, amount: j.delta, currency: a?.currency ?? 'BOB', lines: [{ accountId: j.accountId, amount: j.delta }], undo: { type: 'adjust', id: j.id } });
  }

  return out.sort((x, y) => (x.date === y.date ? (y.time || '00:00').localeCompare(x.time || '00:00') : y.date.localeCompare(x.date)));
}

/** Lo que movió en una cuenta (en su moneda). */
export function amountIn(m: Movement, accountId: string): number {
  return round2(m.lines.filter((l) => l.accountId === accountId).reduce((s, l) => s + l.amount, 0));
}

/** Pagos fijos y de deudas de un día (para verlos en Hoy, sin contar para tu límite). */
export function fixedOn(state: AppState, day: ISODate): Movement[] {
  return movements(state)
    .filter((m) => m.date === day && (m.kind === 'pago' || m.kind === 'deuda' || m.kind === 'cobro'))
    .reverse();
}
