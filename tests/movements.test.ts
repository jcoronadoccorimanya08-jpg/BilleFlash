import { describe, expect, it } from 'vitest';
import { amountIn, fixedOn, movements } from '../src/lib/movements';
import type { AppState } from '../src/lib/types';

function st(): AppState {
  return {
    schema: 1,
    settings: { startDate: '2026-11-01', rate: 3.45, quincena: { amount: 800, saving: 100, days: 15 }, carryStart: 0, savingAccountId: 'ahorro', discreet: false, theme: 'system', autoLockMinutes: 1, createdAt: '' },
    accounts: [
      { id: 'efe', name: 'Efectivo', currency: 'BOB', kind: 'efectivo', balance: 100 },
      { id: 'bnb', name: 'BNB', currency: 'BOB', kind: 'banco', balance: 500 },
      { id: 'ahorro', name: 'Ahorro', currency: 'BOB', kind: 'ahorro', balance: 100 },
    ],
    expenses: [{ id: 'e1', date: '2026-11-25', time: '07:05', desc: 'Cena', amount: 45, accountId: 'bnb' }],
    incomes: [{ id: 'q1', date: '2026-11-24', time: '09:00', desc: 'Quincena', amount: 800, accountId: 'bnb', quincena: { saving: 100 } }],
    transfers: [{ id: 't1', date: '2026-11-25', time: '10:00', from: 'bnb', to: 'efe', amount: 50, received: 50 }],
    days: {},
    debts: [{ id: 'd1', dir: 'debo', person: 'Papá', currency: 'BOB', amount: 300, payments: [{ date: '2026-11-25', amount: 100, accountId: 'efe', time: '11:00' }] }],
    bills: [{ id: 'net', name: 'Internet', amount: 249, currency: 'BOB', kind: 'mensual', nextDue: '2026-12-26', source: 'mio', paid: [{ date: '2026-11-25', due: '2026-10-26', amount: 498, accountId: 'bnb', months: 2, time: '12:00' }] }],
    shots: [],
    goals: [],
    team: [],
    adjusts: [{ id: 'a1', date: '2026-11-25', time: '13:00', accountId: 'efe', delta: -2 }],
  };
}

describe('movimientos', () => {
  it('junta todo, lo más nuevo primero, y dice de qué cuenta salió', () => {
    const list = movements(st());
    expect(list.map((m) => m.kind)).toEqual(['ajuste', 'pago', 'deuda', 'mover', 'gasto', 'ingreso']);
    const pago = list.find((m) => m.kind === 'pago')!;
    expect(pago.title).toBe('Internet (2 meses)');
    expect(pago.lines).toEqual([{ accountId: 'bnb', amount: -498 }]);
    expect(pago.undo).toEqual({ type: 'bill', billId: 'net', index: 0 });
  });
  it('la quincena muestra lo que se fue al ahorro', () => {
    const q = movements(st()).find((m) => m.kind === 'ingreso')!;
    expect(amountIn(q, 'bnb')).toBe(700);
    expect(amountIn(q, 'ahorro')).toBe(100);
  });
  it('lo de una cuenta cuadra con su saldo', () => {
    // BNB: +800 −100 (ahorro) −45 −50 −498 = 107
    const sum = movements(st()).reduce((s, m) => s + amountIn(m, 'bnb'), 0);
    expect(Math.round(sum * 100) / 100).toBe(107);
  });
  it('los pagos fijos y de deudas de hoy se ven en la lista del día', () => {
    expect(fixedOn(st(), '2026-11-25').map((m) => m.title)).toEqual(['Pagaste a Papá', 'Internet (2 meses)']);
  });
});
