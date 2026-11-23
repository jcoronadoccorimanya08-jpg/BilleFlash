import { describe, expect, it } from 'vitest';
import { appDay, addMonths } from '../src/lib/dates';
import { alerts, billStatus, capital, collectMessage, dayStatus, nextInstallment, parseAmount, quincenaStatus, spentOn, streak } from '../src/lib/engine';
import type { AppState, Bill, Debt, Expense } from '../src/lib/types';

/** La Paz es UTC−4: las 20:00 de La Paz son las 00:00Z del día siguiente. */
const lp = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const t = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), h + 4, m);
  return new Date(t);
};

function base(): AppState {
  return {
    schema: 1,
    settings: { startDate: '2026-11-20', rate: 3.45, quincena: { amount: 600, saving: 60, days: 15 }, carryStart: 0, savingAccountId: 'ahorro', discreet: false, theme: 'system', autoLockMinutes: 1, createdAt: '' },
    accounts: [
      { id: 'monedas', name: 'Monedas', currency: 'BOB', kind: 'efectivo', balance: 40 },
      { id: 'bnb', name: 'BNB', currency: 'BOB', kind: 'banco', balance: 50 },
      { id: 'bn', name: 'B. Nación', currency: 'PEN', kind: 'banco', balance: 2 },
      { id: 'ahorro', name: 'Ahorro', currency: 'BOB', kind: 'ahorro', balance: 0 },
    ],
    expenses: [],
    incomes: [],
    transfers: [],
    days: {},
    debts: [],
    bills: [],
    shots: [],
  };
}
const exp = (date: string, amount: number, extra: Partial<Expense> = {}): Expense => ({ id: `${date}-${amount}-${Math.random()}`, date, time: '12:00', desc: 'x', amount, accountId: 'monedas', ...extra });

describe('día de la app', () => {
  it('cambia a las 4:00 de La Paz', () => {
    expect(appDay(lp('2026-11-23', '23:50'))).toBe('2026-11-23');
    expect(appDay(lp('2026-11-24', '02:45'))).toBe('2026-11-23');
    expect(appDay(lp('2026-11-24', '04:00'))).toBe('2026-11-24');
  });
  it('suma meses sin pasarse del último día', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-29', 2)).toBe('2027-01-29');
  });
});

describe('cierre y racha', () => {
  it('antes de medianoche 100 %, de madrugada 75 %, cada olvido −15 %', () => {
    const s = base();
    s.days['2026-11-21'] = { closedAt: lp('2026-11-21', '22:40').toISOString() };
    s.days['2026-11-22'] = { closedAt: lp('2026-11-23', '02:45').toISOString() };
    s.expenses.push(exp('2026-11-22', 5, { forgot: true }), exp('2026-11-22', 3, { forgot: true }));
    const now = lp('2026-11-23', '15:00');
    expect(dayStatus(s, '2026-11-21', now)).toMatchObject({ kind: 'closed', pct: 100 });
    expect(dayStatus(s, '2026-11-22', now)).toMatchObject({ kind: 'closed', pct: 45, late: true, forgot: 2 });
  });
  it('nunca baja de 10 % si cerraste', () => {
    const s = base();
    s.days['2026-11-21'] = { closedAt: lp('2026-11-21', '21:00').toISOString() };
    for (let i = 0; i < 9; i++) s.expenses.push(exp('2026-11-21', 1, { forgot: true }));
    expect(dayStatus(s, '2026-11-21', lp('2026-11-22', '10:00'))).toMatchObject({ kind: 'closed', pct: 10 });
  });
  it('sin cerrar a las 4:00 es 0 % y corta la racha; hoy abierto no corta', () => {
    const s = base();
    s.days['2026-11-20'] = { closedAt: lp('2026-11-20', '22:00').toISOString() };
    s.days['2026-11-22'] = { closedAt: lp('2026-11-22', '22:00').toISOString() };
    s.days['2026-11-23'] = { closedAt: lp('2026-11-23', '22:00').toISOString() };
    expect(dayStatus(s, '2026-11-21', lp('2026-11-22', '05:00')).kind).toBe('missed');
    expect(streak(s, lp('2026-11-24', '20:00'))).toBe(2);
    expect(streak(s, lp('2026-11-25', '05:00'))).toBe(0);
  });
});

describe('quincena y límite', () => {
  it('límite fijo de (quincena − ahorro) ÷ 15 y lo que sobra pasa a la siguiente', () => {
    const s = base();
    s.incomes.push({ id: 'q1', date: '2026-11-23', time: '10:00', desc: 'Quincena', amount: 600, accountId: 'bnb', quincena: { saving: 60 } });
    s.expenses.push(exp('2026-11-23', 25), exp('2026-11-23', 17), exp('2026-11-24', 8));
    const q = quincenaStatus(s, '2026-11-24');
    expect(q.limit).toBe(36);
    expect(q.spent).toBe(50);
    expect(q.available).toBe(490);
    expect(q.nextIn).toBe(14);
    s.incomes.push({ id: 'q2', date: '2026-12-08', time: '10:00', desc: 'Quincena', amount: 600, accountId: 'bnb', quincena: { saving: 60 } });
    expect(quincenaStatus(s, '2026-12-08').carry).toBe(490);
    expect(quincenaStatus(s, '2026-12-08').available).toBe(1030);
  });
  it('un gasto en soles cuenta en Bs con tu tipo de cambio', () => {
    const s = base();
    s.expenses.push(exp('2026-11-23', 2, { accountId: 'bn' }));
    expect(spentOn(s, '2026-11-23')).toBe(6.9);
  });
});

describe('capital', () => {
  it('lo que tienes + lo que te deben − lo que debes, en Bs', () => {
    const s = base();
    s.debts = [
      { id: 'a', dir: 'me-deben', person: 'A', currency: 'PEN', amount: 100, payments: [] },
      { id: 'b', dir: 'debo', person: 'B', currency: 'PEN', amount: 50, payments: [{ date: '2026-11-22', amount: 10 }] },
    ];
    const c = capital(s);
    expect(c.enMano).toBeCloseTo(40 + 50 + 2 * 3.45, 2);
    expect(c.meDeben).toBe(345);
    expect(c.debo).toBe(138);
    expect(c.capital).toBeCloseTo(c.enMano + 345 - 138, 2);
  });
});

describe('cuotas', () => {
  const d: Debt = { id: 'm', dir: 'me-deben', person: 'Ana', currency: 'PEN', amount: 500, plan: { amount: 100, everyDays: 7, start: '2026-11-24' }, payments: [] };
  it('la próxima cuota según lo pagado', () => {
    expect(nextInstallment(d, '2026-11-23')).toEqual({ date: '2026-11-24', amount: 100, inDays: 1 });
    expect(nextInstallment({ ...d, payments: [{ date: '2026-11-24', amount: 150 }] }, '2026-11-25')).toEqual({ date: '2026-12-01', amount: 50, inDays: 6 });
    expect(nextInstallment({ ...d, payments: [{ date: '2026-11-24', amount: 500 }] }, '2026-11-25')).toBeNull();
  });
  it('avisa cobrar y arma un mensaje amable', () => {
    const s = base();
    s.debts = [d];
    expect(alerts(s, '2026-11-24')[0]?.short).toBe('Cobrar a Ana hoy');
    expect(collectMessage(d, '2026-11-24')).toContain('S/ 100');
  });
});

describe('pagos que se repiten', () => {
  const internet: Bill = { id: 'i', name: 'Internet', amount: 100, currency: 'BOB', kind: 'mensual', nextDue: '2026-09-01', source: 'depa', paid: [] };
  it('cuenta los meses atrasados', () => {
    const st = billStatus(internet, '2026-11-23');
    expect(st.kind).toBe('late');
    expect(st.dues).toEqual(['2026-09-01', '2026-10-01', '2026-11-01']);
    expect(st.owed).toBe(300);
  });
  it('vence pronto y al día', () => {
    expect(billStatus({ ...internet, nextDue: '2026-11-26' }, '2026-11-23').kind).toBe('soon');
    expect(billStatus({ ...internet, nextDue: '2026-11-23' }, '2026-11-23').kind).toBe('today');
    expect(billStatus({ ...internet, nextDue: '2026-12-29' }, '2026-11-23').kind).toBe('ok');
    expect(billStatus({ ...internet, kind: 'recibo', nextDue: undefined }, '2026-11-23').kind).toBe('none');
  });
});

describe('montos escritos a mano', () => {
  it('acepta coma, punto y texto', () => {
    expect(parseAmount('12,50')).toBe(12.5);
    expect(parseAmount('Bs 25')).toBe(25);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('0')).toBeNull();
  });
});
