/**
 * Reglas de BilleFlash: funciones puras (sin fechas «de ahora» escondidas: siempre se pasan).
 * Todo lo que se compara entre monedas se pasa a Bs con el tipo de cambio que escribiste.
 */
import { FORGOT_PENALTY, LATE_PCT, MIN_CLOSED_PCT, MOUNTAIN_DAYS, ON_TIME_PCT, SOON_DAYS } from './config';
import { addDays, addMonths, appDay, diffDays, maxDate, rangeDates, todayISO, type ISODate } from './dates';
import type { Account, AppState, Bill, CapitalShot, Category, Currency, Debt, Expense, Goal, Income } from './types';

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
  const usd = state.settings.usdRate;
  return { date, time, rate: state.settings.rate, ...(usd ? { usd } : {}), enMano: c.enMano, meDeben: c.meDeben, debo: c.debo, capital: c.capital };
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

/** «$ 243,10». */
export function dollars(n: number): string {
  return `$ ${nf.format(round2(n))}`;
}

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

// ---------- Categorías ----------

export interface CategoryInfo {
  id: Category;
  label: string;
  /** Token de color (variable CSS) para las gráficas. */
  color: string;
  /** Palabras que la delatan (sin tildes, en minúscula). */
  words: string[];
}

export const CATEGORIES: CategoryInfo[] = [
  { id: 'comida', label: 'Comida', color: '--h2', words: ['almuerzo', 'desayuno', 'cena', 'comida', 'pollo', 'pan', 'huevo', 'sopa', 'menu', 'salteña', 'saltena', 'api', 'quinua', 'mercado', 'fruta', 'leche', 'arroz', 'fideo', 'carne', 'papa', 'tucumana', 'hamburguesa', 'pizza', 'broaster', 'plancha'] },
  { id: 'pasaje', label: 'Pasaje', color: '--h1', words: ['pasaje', 'micro', 'minibus', 'trufi', 'taxi', 'teleferico', 'bus', 'transporte', 'uber', 'gasolina', 'moto'] },
  { id: 'antojos', label: 'Antojos', color: '--h4', words: ['chicle', 'agua', 'aguita', 'soda', 'gaseosa', 'refresco', 'coca', 'dulce', 'chocolate', 'galleta', 'snack', 'helado', 'cafe', 'jugo', 'golosina', 'papitas', 'antojo', 'energizante', 'red bull'] },
  { id: 'universidad', label: 'Universidad', color: '--h3', words: ['fotocopia', 'copias', 'impresion', 'libro', 'universidad', 'u ', 'cuaderno', 'material', 'separata', 'guia', 'curso', 'lapicero', 'bata', 'practica'] },
  { id: 'salud', label: 'Salud', color: '--h6', words: ['farmacia', 'remedio', 'medicina', 'pastilla', 'doctor', 'consulta', 'gym', 'gimnasio', 'suplemento', 'proteina'] },
  { id: 'casa', label: 'Casa', color: '--h5', words: ['luz', 'internet', 'alquiler', 'depa', 'gas', 'limpieza', 'jabon', 'detergente', 'papel', 'shampoo'] },
  { id: 'otros', label: 'Otros', color: '--faint', words: [] },
];

const clean = (t: string) =>
  ` ${t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')} `;

/** Adivina la categoría por lo que escribiste («Almuerzo» → comida, «Chicle» → antojos). */
export function guessCategory(desc: string): Category {
  const t = clean(desc);
  for (const c of CATEGORIES) if (c.words.some((w) => t.includes(w.endsWith(' ') ? ` ${w}` : w))) return c.id;
  return 'otros';
}

export function categoryOf(e: Expense): Category {
  return e.category ?? guessCategory(e.desc);
}

export function categoryInfo(id: Category): CategoryInfo {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1]!;
}

/** Lo gastado por categoría entre dos días (incluidos), en Bs. */
export function spentByCategory(state: AppState, from: ISODate, to: ISODate): Record<Category, number> {
  const out = Object.fromEntries(CATEGORIES.map((c) => [c.id, 0])) as Record<Category, number>;
  for (const e of state.expenses) if (e.date >= from && e.date <= to) out[categoryOf(e)] += expenseBs(state, e.amount, e.accountId);
  for (const k of Object.keys(out) as Category[]) out[k] = round2(out[k]);
  return out;
}

// ---------- Favoritos de un toque ----------

export interface Favorite {
  desc: string;
  amount: number;
  accountId: string;
  count: number;
}

/** Lo que más repites (mismo nombre y monto, al menos 2 veces en 30 días). */
export function favorites(state: AppState, today: ISODate, n = 4): Favorite[] {
  const from = addDays(today, -30);
  const map = new Map<string, Favorite & { last: string }>();
  for (const e of state.expenses) {
    if (e.date < from || e.date > today) continue;
    const key = `${clean(e.desc).trim()}|${e.amount}`;
    const stamp = `${e.date} ${e.time}`;
    const f = map.get(key);
    if (!f) map.set(key, { desc: e.desc, amount: e.amount, accountId: e.accountId, count: 1, last: stamp });
    else {
      f.count++;
      if (stamp > f.last) {
        f.last = stamp;
        f.accountId = e.accountId;
        f.desc = e.desc;
      }
    }
  }
  return [...map.values()]
    .filter((f) => f.count >= 2 && state.accounts.some((a) => a.id === f.accountId))
    .sort((a, b) => b.count - a.count || b.last.localeCompare(a.last))
    .slice(0, n)
    .map(({ last: _l, ...f }) => {
      void _l;
      return f;
    });
}

// ---------- Antojos ----------

/**
 * Cuánto te queda hoy para antojos: tu límite − lo gastado − lo que todavía te falta para comer
 * (lo que sueles gastar en comida por día, según tus últimos 14 días, menos lo que ya comiste hoy).
 */
export function antojosLeft(state: AppState, today: ISODate): { left: number; reserve: number } {
  const limit = quincenaStatus(state, today).limit;
  const spent = spentOn(state, today);
  const comida = (d: ISODate) => state.expenses.filter((e) => e.date === d && categoryOf(e) === 'comida').reduce((s, e) => s + expenseBs(state, e.amount, e.accountId), 0);
  const past = rangeDates(addDays(today, -14), addDays(today, -1)).filter((d) => state.expenses.some((e) => e.date === d));
  const avg = past.length ? past.reduce((s, d) => s + comida(d), 0) / past.length : 0;
  const reserve = round2(Math.max(0, avg - comida(today)));
  return { left: round2(Math.max(0, limit - spent - reserve)), reserve };
}

// ---------- Metas de ahorro ----------

export function goalLeft(g: Goal): number {
  return Math.max(0, round2(g.target - g.saved));
}

/** Para llegar a tiempo: cuánto apartar en cada quincena (null si la meta no tiene fecha o ya está). */
export function goalPerQuincena(g: Goal, today: ISODate, days: number): { per: number; quincenas: number } | null {
  const left = goalLeft(g);
  if (!g.deadline || left <= 0) return null;
  const quincenas = Math.max(1, Math.ceil(Math.max(0, diffDays(today, g.deadline)) / Math.max(1, days)));
  return { per: round2(left / quincenas), quincenas };
}

/**
 * Reparte el ahorro de una quincena entre tus metas: primero lo que pide cada meta con fecha (la más cercana
 * primero) y lo que sobra, a la principal. Lo que no entra queda «sin asignar» en tu ahorro.
 */
export function allocateSaving(goals: Goal[], saving: number, today: ISODate, days: number): Record<string, number> {
  const out: Record<string, number> = {};
  let rest = round2(saving);
  const room = (g: Goal) => goalLeft(g) - (out[g.id] ?? 0);
  const give = (g: Goal, n: number) => {
    const a = round2(Math.min(n, room(g), rest));
    if (a <= 0) return;
    out[g.id] = round2((out[g.id] ?? 0) + a);
    rest = round2(rest - a);
  };
  for (const g of [...goals].filter((x) => x.deadline).sort((a, b) => a.deadline!.localeCompare(b.deadline!))) {
    const s = goalPerQuincena(g, today, days);
    if (s) give(g, s.per);
  }
  const main = goals.find((g) => g.main) ?? goals[0];
  if (main) give(main, rest);
  return out;
}

/** Lo que tienes en tu cuenta de ahorro y todavía no es de ninguna meta (Bs). */
export function unassignedSaving(state: AppState): number {
  const r = state.settings.rate;
  const total = state.accounts.filter((a) => a.kind === 'ahorro').reduce((s, a) => s + toBs(a.balance, a.currency, r), 0);
  return round2(total - state.goals.reduce((s, g) => s + g.saved, 0));
}

export function mainGoal(state: AppState): Goal | undefined {
  return state.goals.find((g) => g.main) ?? state.goals[0];
}

// ---------- Para las gráficas y el resumen ----------

export interface DayBar {
  date: ISODate;
  spent: number;
  limit: number;
}

/** Lo gastado de cada día contra tu límite (últimos n días). */
export function dailyBars(state: AppState, today: ISODate, n = 14): DayBar[] {
  const from = maxDate(state.settings.startDate, addDays(today, -(n - 1)));
  if (from > today) return [];
  return rangeDates(from, today).map((date) => ({ date, spent: spentOn(state, date), limit: quincenaStatus(state, date).limit }));
}

export interface QuincenaSummary {
  q: Income;
  from: ISODate;
  to: ISODate;
  /** ¿Ya terminó (llegó la siguiente)? */
  done: boolean;
  spent: number;
  budget: number;
  saving: number;
  byCategory: Record<Category, number>;
  daysWithin: number;
  days: number;
  nightsClosed: number;
}

/** Cada quincena: cuánto gastaste, en qué, cuánto ahorraste y cuántos días quedaste dentro del límite. */
export function quincenaSummaries(state: AppState, today: ISODate, now: Date): QuincenaSummary[] {
  const list = quincenas(state).filter((q) => q.date <= today);
  return list
    .map((q, i) => {
      const next = list[i + 1];
      const to = next ? addDays(next.date, -1) : today;
      const dates = rangeDates(q.date, to);
      const limit = quincenaStatus(state, q.date).limit;
      return {
        q,
        from: q.date,
        to,
        done: Boolean(next),
        spent: round2(dates.reduce((s, d) => s + spentOn(state, d), 0)),
        budget: round2(q.amount - (q.quincena?.saving ?? 0)),
        saving: q.quincena?.saving ?? 0,
        byCategory: spentByCategory(state, q.date, to),
        daysWithin: dates.filter((d) => spentOn(state, d) <= limit + 0.001).length,
        days: dates.length,
        nightsClosed: dates.filter((d) => dayStatus(state, d, now).kind === 'closed').length,
      };
    })
    .reverse();
}
