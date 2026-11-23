import { describe, expect, it } from 'vitest';
import { appDay, addMonths } from '../src/lib/dates';
import { alerts, allocateSaving, antojosLeft, billStatus, capital, collectMessage, dailyBars, dayStatus, favorites, goalPerQuincena, guessCategory, nextInstallment, parseAmount, quincenaStatus, quincenaSummaries, spentOn, streak, unassignedSaving } from '../src/lib/engine';
import type { AppState, Bill, Debt, Expense, Goal } from '../src/lib/types';
import { buildWidgetFrame } from '../src/lib/widget';

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
    goals: [],
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

describe('categorías, favoritos y antojos', () => {
  it('adivina la categoría por lo que escribes', () => {
    expect(guessCategory('Almuerzo')).toBe('comida');
    expect(guessCategory('Pan con quinua')).toBe('comida');
    expect(guessCategory('Pasaje')).toBe('pasaje');
    expect(guessCategory('Chicle')).toBe('antojos');
    expect(guessCategory('Agüita')).toBe('antojos');
    expect(guessCategory('Fotocopias anatomía')).toBe('universidad');
    expect(guessCategory('Algo raro')).toBe('otros');
  });
  it('favoritos: lo que repites con el mismo monto', () => {
    const s = base();
    s.expenses.push(exp('2026-11-21', 25, { desc: 'Almuerzo' }), exp('2026-11-22', 25, { desc: 'almuerzo' }), exp('2026-11-22', 3, { desc: 'Pasaje' }), exp('2026-11-23', 3, { desc: 'Pasaje' }), exp('2026-11-23', 8, { desc: 'Agua' }));
    const f = favorites(s, '2026-11-23');
    expect(f.map((x) => `${x.desc} ${x.amount}`)).toEqual(['Pasaje 3', 'almuerzo 25']);
  });
  it('antojos: el límite menos lo gastado y lo que todavía falta para comer', () => {
    const s = base();
    s.incomes.push({ id: 'q', date: '2026-11-20', time: '10:00', desc: 'Quincena', amount: 600, accountId: 'bnb', quincena: { saving: 60 } });
    // Sueles gastar 40 en comida por día.
    s.expenses.push(exp('2026-11-21', 25, { desc: 'Almuerzo' }), exp('2026-11-21', 15, { desc: 'Cena' }), exp('2026-11-22', 40, { desc: 'Almuerzo' }));
    s.expenses.push(exp('2026-11-23', 25, { desc: 'Almuerzo' }), exp('2026-11-23', 3, { desc: 'Pasaje' }));
    // Límite 36 − gastado 28 − falta comer 15 → 0 (no alcanza para antojos).
    expect(antojosLeft(s, '2026-11-23')).toEqual({ left: 0, reserve: 15 });
    const r = antojosLeft({ ...s, expenses: s.expenses.filter((e) => e.date !== '2026-11-23') }, '2026-11-23');
    expect(r).toEqual({ left: 0, reserve: 40 });
  });
});

describe('metas de ahorro', () => {
  const g = (id: string, target: number, saved: number, extra: Partial<Goal> = {}): Goal => ({ id, name: id, target, saved, ...extra });
  it('cuánto apartar por quincena para llegar a tiempo', () => {
    expect(goalPerQuincena(g('a', 300, 60, { deadline: '2026-12-23' }), '2026-11-23', 15)).toEqual({ per: 120, quincenas: 2 });
    expect(goalPerQuincena(g('a', 300, 300, { deadline: '2026-12-23' }), '2026-11-23', 15)).toBeNull();
    expect(goalPerQuincena(g('a', 300, 0), '2026-11-23', 15)).toBeNull();
  });
  it('reparte el ahorro: primero las metas con fecha, lo que sobra a la principal', () => {
    const goals = [g('fondo', 500, 0, { main: true }), g('pago', 90, 0, { deadline: '2026-12-08' })];
    expect(allocateSaving(goals, 60, '2026-11-23', 15)).toEqual({ pago: 60 });
    expect(allocateSaving(goals, 100, '2026-11-23', 15)).toEqual({ pago: 90, fondo: 10 });
    expect(allocateSaving([g('x', 20, 15, { main: true })], 60, '2026-11-23', 15)).toEqual({ x: 5 });
  });
  it('lo apartado sale de tu ahorro; el resto queda sin asignar', () => {
    const s = base();
    s.accounts = s.accounts.map((a) => (a.id === 'ahorro' ? { ...a, balance: 100 } : a));
    s.goals = [g('a', 500, 70)];
    expect(unassignedSaving(s)).toBe(30);
  });
});

describe('resumen de la quincena', () => {
  it('cuánto gastaste, en qué y cuántos días quedaste dentro', () => {
    const s = base();
    s.incomes.push({ id: 'q', date: '2026-11-21', time: '10:00', desc: 'Quincena', amount: 600, accountId: 'bnb', quincena: { saving: 60 } });
    s.expenses.push(exp('2026-11-21', 25, { desc: 'Almuerzo' }), exp('2026-11-22', 40, { desc: 'Almuerzo' }), exp('2026-11-22', 6, { desc: 'Chicle' }));
    const [r] = quincenaSummaries(s, '2026-11-23', lp('2026-11-23', '12:00'));
    expect(r).toMatchObject({ spent: 71, budget: 540, saving: 60, daysWithin: 2, days: 3, done: false });
    expect(r!.byCategory.antojos).toBe(6);
    expect(dailyBars(s, '2026-11-23', 3).map((d) => d.spent)).toEqual([25, 46, 0]);
  });
});

describe('widget', () => {
  it('en modo discreto no manda montos ni el nombre de tu meta', () => {
    const s = base();
    s.incomes.push({ id: 'q', date: '2026-11-20', time: '10:00', desc: 'Quincena', amount: 600, accountId: 'bnb', quincena: { saving: 60 } });
    s.goals = [{ id: 'g', name: 'Meta privada', target: 200, saved: 50, main: true }];
    s.expenses.push(exp('2026-11-23', 10));
    const open = buildWidgetFrame(s, lp('2026-11-23', '20:00'));
    expect(open.goal).toEqual({ pct: 25, name: 'Meta privada', saved: 50, target: 200 });
    expect(open.antojos).toBe(26);
    const hidden = buildWidgetFrame({ ...s, settings: { ...s.settings, discreet: true } }, lp('2026-11-23', '20:00'));
    expect(hidden).toMatchObject({ spent: null, limit: null, available: null, antojos: null, goal: { pct: 25, name: null, saved: null, target: null } });
    expect(JSON.stringify(hidden)).not.toContain('Meta privada');
  });
});
