import type { ISODate } from './dates';

export type Theme = 'system' | 'dark' | 'light' | 'black';
export type Accent = 'verde' | 'violeta' | 'lima' | 'rosa' | 'vino';
export type TextSize = 'normal' | 'grande';

/** Bolivianos o soles. */
export type Currency = 'BOB' | 'PEN';

export type AccountKind = 'efectivo' | 'banco' | 'billetera' | 'ahorro';

/** Dónde está tu plata: un banco, tus billetes, tus monedas, Yape, Binance, tu ahorro… */
export interface Account {
  id: string;
  name: string;
  currency: Currency;
  kind: AccountKind;
  /** Saldo actual, en su moneda. */
  balance: number;
}

/** Un gasto del día. */
export interface Expense {
  id: string;
  /** Día de la app (cambia a las 00:00). */
  date: ISODate;
  /** «HH:MM». */
  time: string;
  desc: string;
  /** Monto en la moneda de la cuenta. */
  amount: number;
  accountId: string;
  /** Lo marcaste como olvidado (o lo agregaste después de cerrar el día): resta 15 %. */
  forgot?: boolean;
  /** Categoría elegida a mano (si no, se adivina por la descripción). */
  category?: Category;
}

/** En qué se te va la plata. */
export type Category = 'comida' | 'pasaje' | 'antojos' | 'universidad' | 'salud' | 'casa' | 'otros';

/** Una meta de ahorro: lo que llevas apartado para ella sale de tu ahorro. */
export interface Goal {
  id: string;
  name: string;
  target: number;
  /** Lo que ya apartaste (Bs). */
  saved: number;
  /** Para cuándo (opcional). */
  deadline?: ISODate;
  /** La principal (la que sale en el widget). */
  main?: boolean;
}

/** Plata que entró (un cobro, un regalo, una quincena…). */
export interface Income {
  id: string;
  date: ISODate;
  time: string;
  desc: string;
  amount: number;
  accountId: string;
  /** Si es una quincena: cuánto se fue al ahorro. */
  quincena?: { saving: number; /** Cuánto de ese ahorro fue a cada meta. */ goals?: Record<string, number> };
  /** Modo libre: lo que se apartó solo al ahorro de esta plata. */
  kept?: { saving: number; goals?: Record<string, number> };
}

/** Pasaste plata de una cuenta a otra (sacar del banco, cambiar soles…). */
export interface Transfer {
  id: string;
  date: ISODate;
  time: string;
  from: string;
  to: string;
  /** Lo que sale, en la moneda de «from». */
  amount: number;
  /** Lo que entra, en la moneda de «to». */
  received: number;
}

export interface DayLog {
  /** Cuándo tocaste «Cerrar mi día» (ISO). */
  closedAt?: string;
}

export interface DebtPayment {
  date: ISODate;
  /** En la moneda de la deuda. */
  amount: number;
  /** La cuenta donde entró (te pagan) o de donde salió (pagas). Vacío: no pasó por tus cuentas. */
  accountId?: string;
  /** «HH:MM» (desde la 1.7). */
  time?: string;
}

/** Una deuda, siempre en su moneda (no se cruza sola con otra). */
export interface Debt {
  id: string;
  /** «me-deben»: te deben a ti. «debo»: tú debes. */
  dir: 'me-deben' | 'debo';
  person: string;
  currency: Currency;
  amount: number;
  note?: string;
  /** Plan de cuotas: cuánto y cada cuántos días, desde una fecha. */
  plan?: { amount: number; everyDays: number; start: ISODate };
  payments: DebtPayment[];
}

/** Un pago que se repite: depa, luz, internet, Claude, gym, agua… */
export interface Bill {
  id: string;
  name: string;
  amount: number;
  currency: Currency;
  /** Mensual (con su día) o cuando llega el recibo. */
  kind: 'mensual' | 'recibo';
  /** La próxima fecha que falta pagar. Sin fecha: no hay recibo pendiente. */
  nextDue?: ISODate;
  /** «mio»: sale de tus cuentas. «depa»: de la plata del depa que te mandan aparte. */
  source: 'mio' | 'depa';
  /** Pagos hechos (para el historial). */
  paid: BillPayment[];
}

export interface BillPayment {
  date: ISODate;
  /** El primer vencimiento que cubrió. */
  due: ISODate;
  amount: number;
  accountId?: string;
  /** Cuántos meses cubrió este pago (sin dato: 1). */
  months?: number;
  /** «HH:MM» (desde la 1.7). */
  time?: string;
}

/** Cuadraste una cuenta a mano: cuánto subió o bajó (queda en tus movimientos). */
export interface Adjust {
  id: string;
  date: ISODate;
  time: string;
  accountId: string;
  /** En la moneda de la cuenta (+ subió, − bajó). */
  delta: number;
}

/** Foto de tu capital al cerrar un día (tu tabla amarilla, pero sola). En Bs. */
export interface CapitalShot {
  date: ISODate;
  time: string;
  rate: number;
  /** En qué moneda está esta foto (sin dato: Bs). */
  cur?: Currency;
  /** Soles por 1 dólar, si lo escribiste (para la columna en dólares). */
  usd?: number;
  enMano: number;
  meDeben: number;
  debo: number;
  capital: number;
}

export interface Settings {
  /** Desde cuándo cuenta la racha. */
  startDate: ISODate;
  /** Tipo de cambio: cuántos Bs vale 1 sol. Cambia cuando quieras. */
  rate: number;
  /** Soles por 1 dólar (opcional, solo para ver tu capital en dólares). */
  usdRate?: number;
  /** Tu moneda principal: en ella se ven tu límite, tu capital y tus gráficas (sin dato: Bs). */
  mainCurrency?: Currency;
  /** Cómo te llega la plata: por quincena (fija) o libre (cuando te dan, sin fecha). */
  incomeMode?: 'quincena' | 'libre';
  /** Modo libre: tu límite de cada día (en tu moneda principal). */
  dailyLimit?: number;
  /** Modo libre: qué % de cada plata que te dan se va solo al ahorro. */
  savingPct?: number;
  /** Hora del aviso de la noche («HH:MM»), para el widget. */
  remindAt?: string;
  /** Tu código de equipo (para cifrar el resumen que le mandas a tu entrenador). */
  teamCode?: string;
  /** Lo último que te mandó tu entrenador. */
  coachNote?: { text: string; at: string };
  /** Tu quincena. */
  quincena: { amount: number; saving: number; days: number };
  /** Lo que te sobró antes de usar la app (pasa a tu primera quincena). */
  carryStart: number;
  /** Cuenta donde va el ahorro de cada quincena. */
  savingAccountId?: string;
  /** Widget: ocultar montos. */
  discreet: boolean;
  /** Tu nombre corto para las frases (opcional, se escribe en la app). */
  nick?: string;
  theme: Theme;
  accent?: Accent;
  textSize?: TextSize;
  /** Código de sincronización celular ↔ tablet (solo dentro de tus datos cifrados). */
  syncCode?: string;
  autoLockMinutes: number;
  lastBackupAt?: string;
  /** La última cuenta donde entró un cobro de deuda (viene elegida la próxima vez). */
  lastCollectAccount?: string;
  createdAt: string;
}

export interface AppState {
  schema: 1;
  settings: Settings;
  accounts: Account[];
  expenses: Expense[];
  incomes: Income[];
  transfers: Transfer[];
  days: Record<ISODate, DayLog>;
  debts: Debt[];
  bills: Bill[];
  shots: CapitalShot[];
  goals: Goal[];
  /** Modo entrenador: las personas que te mandan su resumen. */
  team: TeamMember[];
  /** Cuadres a mano (desde la 1.7). */
  adjusts?: Adjust[];
  /** Pagos fijos quitados: se pueden recuperar (desde la 1.8). */
  removedBills?: RemovedBill[];
}

export type RemovedBill = Bill & { removedAt: string };

export interface TeamMember {
  id: string;
  name: string;
  /** El código que acordaron (para abrir su resumen). */
  code: string;
  /** Su último resumen (lo que ella eligió mandarte). */
  last?: unknown;
  lastAt?: string;
}
