import type { Account, AccountKind, Currency } from './types';

export const APP_NAME = 'BilleFlash';

/** Cerrar el día a tiempo (antes de medianoche) vale 100 %; de 00:00 a 03:59, 75 %. */
export const ON_TIME_PCT = 100;
export const LATE_PCT = 75;
/** Cada gasto olvidado resta esto. */
export const FORGOT_PENALTY = 15;
/** Lo mínimo que vale un día cerrado. */
export const MIN_CLOSED_PCT = 10;
/** Días de la montaña. */
export const MOUNTAIN_DAYS = 14;
/** Avisar un pago o un cobro con estos días de anticipación. */
export const SOON_DAYS = 3;

export const DEFAULT_RATE = 3.45;

export const CURRENCY_SIGN: Record<Currency, string> = { BOB: 'Bs', PEN: 'S/' };

export const KIND_LABEL: Record<AccountKind, string> = {
  efectivo: 'Efectivo',
  banco: 'Banco',
  billetera: 'Billetera (QR, Yape, Binance…)',
  ahorro: 'Ahorro',
};

/** Cuentas con las que arranca la app (sin montos). Las demás las agregas tú. */
export const DEFAULT_ACCOUNTS: Account[] = [
  { id: 'billetes', name: 'Billetes', currency: 'BOB', kind: 'efectivo', balance: 0 },
  { id: 'monedas', name: 'Monedas', currency: 'BOB', kind: 'efectivo', balance: 0 },
  { id: 'ahorro', name: 'Ahorro', currency: 'BOB', kind: 'ahorro', balance: 0 },
];

/** Frases sin culpa para el cierre del día. */
export const CLOSE_PHRASES = {
  within: ['Día cerrado y dentro del límite. Así se hace.', 'Cuentas claras, día ganado.', 'Revisaste y cuidaste tu plata. Bien ahí.'],
  over: ['Día cerrado. Te pasaste un poco: mañana lo equilibras.', 'Lo importante: revisaste. Mañana, más tranqui con los antojos.'],
};
