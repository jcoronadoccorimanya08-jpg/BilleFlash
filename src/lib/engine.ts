/**
 * Reglas de BilleFlash: funciones puras (sin fechas «de ahora» escondidas: siempre se pasan).
 * Todo lo que se compara entre monedas se pasa a Bs con el tipo de cambio que escribiste.
 */
import { FORGOT_PENALTY, LATE_PCT, MIN_CLOSED_PCT, MOUNTAIN_DAYS, ON_TIME_PCT, SOON_DAYS } from './config';
import { addDays, addMonths, appDay, diffDays, maxDate, rangeDates, todayISO, type ISODate } from './dates';
import type { Account, AppState, Bill, CapitalShot, Currency, Debt, Income } from './types';

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function toBs(amount: number, currency: Currency, rate: number): number {
  return currency === 'PEN' ? amount * rate : amount;
}

export function accountOf(state: AppState, id: string | undefined): Account | undefined {
  return state.accounts.find((a) => a.id === id);
}

/** Un gasto, en Bs. */
function expenseBs(state: AppState, amount: number, accountId: string): number {
  const acc = accountOf(state, accountId);
  return toBs(amount, acc?.currency ?? 'BOB', state.settings.rate);
}

export function spentOn(state: AppState, day: ISODate): number {
  return round2(state.expenses.filter((e) => e.date === day).reduce((s, e) => s + expenseBs(state, e.amount, e.accountId), 0));
}

// ---------- Cierre del día y racha ----------

export type DayStatus =
  | { kind: 'before' }
  | { kind: 'open'; forgot: number }
  | { kind: 'closed'; pct: number; late: boolean; forgot: number }
  | { kind: 'missed' };

export function forgotCount(state: AppState, day: ISODate): number {
  return state.expenses.filter((e) => e.date === day && e.forgot).length;
}

/**
 * Cómo te fue con el hábito de revisar: cerrar antes de medianoche vale 100 %; de 00:00 a 03:59, 75 %.
 * Cada gasto olvidado resta 15 % (mínimo 10 %). Si a las 4:00 no cerraste, ese día vale 0 % y corta la racha.
 */
export function dayStatus(state: AppState, day: ISODate, now: Date): DayStatus {
  if (day < state.settings.startDate) return { kind: 'before' };
  const forgot = forgotCount(state, day);
  const closedAt = state.days[day]?.closedAt;
  if (closedAt) {
    const late = todayISO(new Date(closedAt)) !== day;
    const pct = Math.max(MIN_CLOSED_PCT, (late ? LATE_PCT : ON_TIME_PCT) - FORGOT_PENALTY * forgot);
    return { kind: 'closed', pct, late, forgot };
  }
  return appDay(now) > day ? { kind: 'missed' } : { kind: 'open', forgot };
}

export function dayPct(st: DayStatus): number {
  return st.kind === 'closed' ? st.pct : 0;
}

/** ¿Todavía puedes cerrar este día? Solo el día de la app (hasta las 4:00 del siguiente). */
export function canClose(state: AppState, day: ISODate, now: Date): boolean {
  return day === appDay(now) && day >= state.settings.startDate && !state.days[day]?.closedAt;
}

/** Noches seguidas cerradas. Hoy, si todavía no cierras, no corta. */
export function streak(state: AppState, now: Date): number {
  let d = appDay(now);
  let n = 0;
  if (dayStatus(state, d, now).kind === 'open') d = addDays(d, -1);
  while (d >= state.settings.startDate && dayStatus(state, d, now).kind === 'closed') {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

export function bestStreak(state: AppState, now: Date): number {
  const today = appDay(now);
  if (today < state.settings.startDate) return 0;
  let best = 0;
  let run = 0;
  for (const d of rangeDates(state.settings.startDate, today)) {
    const k = dayStatus(state, d, now).kind;
    if (k === 'closed') best = Math.max(best, ++run);
    else if (k !== 'open') run = 0;
  }
  return best;
}

export interface MountainDay {
  date: ISODate;
  pct: number;
  closed: boolean;
}

/** La montaña: el porcentaje de cada noche, de los últimos 14 días. */
export function mountain(state: AppState, now: Date, days = MOUNTAIN_DAYS): MountainDay[] {
  const today = appDay(now);
  if (today < state.settings.startDate) return [];
  return rangeDates(maxDate(state.settings.startDate, addDays(today, -(days - 1))), today).map((date) => {
    const st = dayStatus(state, date, now);
    return { date, pct: dayPct(st), closed: st.kind === 'closed' };
  });
}

// ---------- Quincena y límite diario ----------

export function quincenas(state: AppState): Income[] {
  return state.incomes.filter((i) => i.quincena).sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)));
}

export interface QuincenaStatus {
  /** La quincena que corre (o null si todavía no registraste ninguna). */
  q: Income | null;
  /** Lo que es para gastar en esta quincena (sin el ahorro). */
  budget: number;
  /** Lo que sobró (o faltó) de la anterior. */
  carry: number;
  spent: number;
  /** Lo que te queda para gastar hasta la próxima. */
  available: number;
  /** Tu límite de cada día: (quincena − ahorro) ÷ días. Fijo, aunque tengas más disponible. */
  limit: number;
  /** Días que faltan para la próxima quincena (según la fecha esperada; puede ser negativo si se atrasa). */
  nextIn: number | null;
  /** Día de la quincena (1 = el día que llegó). */
  dayIndex: number;
}

export function quincenaStatus(state: AppState, today: ISODate): QuincenaStatus {
  const s = state.settings;
  const list = quincenas(state).filter((q) => q.date <= today);
  const defaultLimit = s.quincena.days > 0 ? round2((s.quincena.amount - s.quincena.saving) / s.quincena.days) : 0;
  if (!list.length) return { q: null, budget: 0, carry: s.carryStart, spent: 0, available: s.carryStart, limit: defaultLimit, nextIn: null, dayIndex: 0 };
  let carry = s.carryStart;
  let res: QuincenaStatus | null = null;
  list.forEach((q, i) => {
    const next = list[i + 1];
    const end = next ? addDays(next.date, -1) : today;
    const spent = round2(rangeDates(q.date, end).reduce((sum, d) => sum + spentOn(state, d), 0));
    const budget = round2(q.amount - (q.quincena?.saving ?? 0));
    const available = round2(budget + carry - spent);
    res = {
      q,
      budget,
      carry: round2(carry),
      spent,
      available,
      limit: s.quincena.days > 0 ? round2(budget / s.quincena.days) : 0,
      nextIn: diffDays(today, addDays(q.date, s.quincena.days)),
      dayIndex: diffDays(q.date, today) + 1,
    };
    carry = available;
  });
  return res!;
}

// ---------- Capital ----------

export function debtPaid(d: Debt): number {
  return round2(d.payments.reduce((s, p) => s + p.amount, 0));
}

export function debtLeft(d: Debt): number {
  return Math.max(0, round2(d.amount - debtPaid(d)));
}

export interface Capital {
  enMano: number;
  ahorro: number;
  meDeben: number;
  debo: number;
  capital: number;
}

/** Tu fórmula de siempre: lo que tienes + lo que te deben − lo que debes. Todo en Bs. */
export function capital(state: AppState): Capital {
  const r = state.settings.rate;
  const enMano = state.accounts.reduce((s, a) => s + toBs(a.balance, a.currency, r), 0);
  const ahorro = state.accounts.filter((a) => a.kind === 'ahorro').reduce((s, a) => s + toBs(a.balance, a.currency, r), 0);
  const meDeben = state.debts.filter((d) => d.dir === 'me-deben').reduce((s, d) => s + toBs(debtLeft(d), d.currency, r), 0);
  const debo = state.debts.filter((d) => d.dir === 'debo').reduce((s, d) => s + toBs(debtLeft(d), d.currency, r), 0);
  return { enMano: round2(enMano), ahorro: round2(ahorro), meDeben: round2(meDeben), debo: round2(debo), capital: round2(enMano + meDeben - debo) };
}

export function shotOf(state: AppState, date: ISODate, time: string): CapitalShot {
  const c = capital(state);
  return { date, time, rate: state.settings.rate, enMano: c.enMano, meDeben: c.meDeben, debo: c.debo, capital: c.capital };
}

// ---------- Cuotas de deudas ----------

export interface Installment {
  date: ISODate;
  amount: number;
  /** Días que faltan (negativo: atrasada). */
  inDays: number;
}

/** La próxima cuota según el plan y lo que ya se pagó. */
export function nextInstallment(d: Debt, today: ISODate): Installment | null {
  const left = debtLeft(d);
  if (!d.plan || left <= 0 || d.plan.amount <= 0 || d.plan.everyDays <= 0) return null;
  const paid = debtPaid(d);
  const i = Math.floor(round2(paid / d.plan.amount) + 1e-9);
  const date = addDays(d.plan.start, i * d.plan.everyDays);
  const amount = round2(Math.min(left, d.plan.amount * (i + 1) - paid));
  return { date, amount, inDays: diffDays(today, date) };
}

// ---------- Pagos que se repiten ----------

export interface BillStatus {
  kind: 'late' | 'today' | 'soon' | 'ok' | 'none';
  /** Recibos o meses atrasados (con el de hoy, si vence hoy). */
  dues: ISODate[];
  /** Lo que debes de ese pago (atrasado + hoy). */
  owed: number;
  /** Días para el próximo vencimiento. */
  inDays: number | null;
}

export function billStatus(b: Bill, today: ISODate): BillStatus {
  if (!b.nextDue) return { kind: 'none', dues: [], owed: 0, inDays: null };
  const dues: ISODate[] = [];
  if (b.kind === 'mensual') {
    for (let d = b.nextDue, guard = 0; d <= today && guard < 120; d = addMonths(b.nextDue, ++guard)) dues.push(d);
  } else if (b.nextDue <= today) dues.push(b.nextDue);
  const inDays = diffDays(today, b.nextDue);
  const late = dues.some((d) => d < today);
  const kind = late ? 'late' : dues.length ? 'today' : inDays <= SOON_DAYS ? 'soon' : 'ok';
  return { kind, dues, owed: round2(dues.length * b.amount), inDays };
}

/** Después de pagar el vencimiento más antiguo: el siguiente (mensual) o ninguno (recibo). */
export function afterPay(b: Bill): ISODate | undefined {
  if (!b.nextDue) return undefined;
  return b.kind === 'mensual' ? addMonths(b.nextDue, 1) : undefined;
}

// ---------- Lo urgente ----------

export interface Alert {
  tone: 'red' | 'amber';
  text: string;
  /** Texto corto para el widget. */
  short: string;
  order: number;
}

export function alerts(state: AppState, today: ISODate): Alert[] {
  const out: Alert[] = [];
  for (const b of state.bills) {
    const st = billStatus(b, today);
    if (st.kind === 'late') {
      const n = st.dues.filter((d) => d < today).length;
      const what = b.kind === 'mensual' ? `${n} ${n === 1 ? 'mes' : 'meses'}` : 'el recibo';
      out.push({ tone: 'red', text: `${b.name}: debes ${what} (${money(st.owed, b.currency)})`, short: `${b.name} atrasado`, order: 0 });
    } else if (st.kind === 'today') out.push({ tone: 'red', text: `${b.name} vence hoy (${money(b.amount, b.currency)})`, short: `${b.name} vence hoy`, order: 1 });
    else if (st.kind === 'soon' && st.inDays !== null)
      out.push({ tone: 'amber', text: `${b.name} vence en ${st.inDays} ${st.inDays === 1 ? 'día' : 'días'}`, short: `${b.name} en ${st.inDays} d`, order: 3 });
  }
  for (const d of state.debts) {
    const inst = nextInstallment(d, today);
    if (!inst || inst.inDays > SOON_DAYS) continue;
    const verb = d.dir === 'me-deben' ? 'Cobrar a' : 'Pagar a';
    const when = inst.inDays < 0 ? 'atrasado' : inst.inDays === 0 ? 'hoy' : `en ${inst.inDays} ${inst.inDays === 1 ? 'día' : 'días'}`;
    out.push({
      tone: inst.inDays <= 0 ? 'red' : 'amber',
      text: `${verb} ${d.person} ${money(inst.amount, d.currency)}: ${when}`,
      short: `${verb} ${d.person} ${when}`,
      order: inst.inDays < 0 ? 0 : inst.inDays === 0 ? 1 : 2,
    });
  }
  return out.sort((a, b) => a.order - b.order);
}

// ---------- Textos ----------

const nf = new Intl.NumberFormat('es-BO', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function money(n: number, currency: Currency = 'BOB'): string {
  return `${currency === 'PEN' ? 'S/' : 'Bs'} ${nf.format(round2(n))}`;
}

/** Lee un monto escrito a mano: «12,50», «12.5», «Bs 12». */
export function parseAmount(text: string): number | null {
  const clean = text.replace(/[^\d,.-]/g, '').replace(',', '.');
  if (!clean) return null;
  const n = Number(clean);
  return Number.isFinite(n) && n > 0 ? round2(n) : null;
}

/** Mensaje amable para cobrar por WhatsApp (tú eliges a quién mandarlo). */
export function collectMessage(d: Debt, today: ISODate): string {
  const inst = nextInstallment(d, today);
  const left = money(debtLeft(d), d.currency);
  const cuota = inst ? ` Según lo que quedamos, ${inst.inDays <= 0 ? 'ya toca' : 'el ' + inst.date.slice(8, 10) + '/' + inst.date.slice(5, 7) + ' toca'} la cuota de ${money(inst.amount, d.currency)}.` : '';
  return `Hola ${d.person}, ¿cómo estás? 😊 Te escribo por la platita que quedó pendiente (faltan ${left}).${cuota} Cuando puedas me avisas, ¡gracias!`;
}

export function whatsappLink(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
