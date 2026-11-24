/**
 * Modo entrenador: el resumen que alguien (por ejemplo, tu hermana) te manda por WhatsApp, cifrado con un
 * código que solo ustedes dos saben. Sin servidores: el archivo viaja como texto y solo se abre con ese código.
 * También sirve al revés: tú le mandas una nota o un reto.
 */
import { decryptJSON, deriveKey, encryptJSON, fromB64, isWrapped, randomBytes, toB64 } from './crypto';
import { addDays, appDay, type ISODate } from './dates';
import { capital, categoryOf, dayStatus, goalLeft, mainOf, mountain, piggyMoves, piggyStats, quincenaStatus, spentOn, streak, toMain, debtLeft } from './engine';
import type { AppState, Category, Currency } from './types';

const APP = 'billeflash';
/** Menos iteraciones que el patrón: el código se escribe a mano y el archivo es de un solo uso. */
const ITER = 150_000;

export interface CoachSummary {
  v: 1;
  name: string;
  at: string;
  today: ISODate;
  cur: Currency;
  rate: number;
  limit: number;
  spentToday: number;
  available: number;
  streak: number;
  closedToday: number | null;
  days: { d: ISODate; p: number; w: boolean; s: number }[];
  expenses: { d: ISODate; t: string; desc: string; a: number; cat: Category; forgot?: true }[];
  incomes: { d: ISODate; desc: string; a: number }[];
  piggy: { total: number; week: number; month: number; streak: number; moves: { d: ISODate; t: string; a: number; what: string }[] };
  goals: { name: string; target: number; saved: number; deadline?: ISODate; main?: true }[];
  capital: { enMano: number; meDeben: number; debo: number; capital: number };
  accounts: { name: string; balance: number; cur: Currency }[];
  debts: { person: string; dir: 'me-deben' | 'debo'; left: number; cur: Currency }[];
}

/** Todo lo que eligió compartir (sus últimos 30 días), en su moneda principal. */
export function buildSummary(state: AppState, now: Date): CoachSummary {
  const today = appDay(now);
  const from = addDays(today, -29);
  const q = quincenaStatus(state, today);
  const st = dayStatus(state, today, now);
  const c = capital(state);
  const acc = (id: string) => state.accounts.find((a) => a.id === id);
  const p = piggyStats(state, today);
  return {
    v: 1,
    name: state.settings.nick ?? 'Sin nombre',
    at: now.toISOString(),
    today,
    cur: mainOf(state),
    rate: state.settings.rate,
    limit: q.limit,
    spentToday: spentOn(state, today),
    available: q.available,
    streak: streak(state, now),
    closedToday: st.kind === 'closed' ? st.pct : null,
    days: mountain(state, now).map((m) => ({ d: m.date, p: m.pct, w: m.closed, s: spentOn(state, m.date) })),
    expenses: state.expenses
      .filter((e) => e.date >= from)
      .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))
      .map((e) => ({ d: e.date, t: e.time, desc: e.desc, a: Math.round(toMain(state, e.amount, acc(e.accountId)?.currency ?? 'BOB') * 100) / 100, cat: categoryOf(e), ...(e.forgot ? { forgot: true as const } : {}) })),
    incomes: state.incomes.filter((i) => i.date >= from).map((i) => ({ d: i.date, desc: i.desc, a: Math.round(toMain(state, i.amount, acc(i.accountId)?.currency ?? 'BOB') * 100) / 100 })),
    piggy: { ...p, moves: piggyMoves(state).filter((m) => m.date >= from).map((m) => ({ d: m.date, t: m.time, a: m.amount, what: m.what })) },
    goals: state.goals.map((g) => ({ name: g.name, target: g.target, saved: g.saved, ...(g.deadline ? { deadline: g.deadline } : {}), ...(g.main ? { main: true as const } : {}) })),
    capital: { enMano: c.enMano, meDeben: c.meDeben, debo: c.debo, capital: c.capital },
    accounts: state.accounts.map((a) => ({ name: a.name, balance: a.balance, cur: a.currency })),
    debts: state.debts.filter((d) => debtLeft(d) > 0).map((d) => ({ person: d.person, dir: d.dir, left: debtLeft(d), cur: d.currency })),
  };
}

export function goalPct(g: { target: number; saved: number }): number {
  return g.target > 0 ? Math.min(100, Math.round((g.saved / g.target) * 100)) : 0;
}
void goalLeft;

type Kind = 'coach-summary' | 'coach-note';

/** Cifra con el código del equipo. El texto resultante se puede mandar por WhatsApp. */
export async function sealForTeam(kind: Kind, data: unknown, code: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await deriveKey(code.trim(), salt, ITER);
  return JSON.stringify({ app: APP, kind, salt: toB64(salt), iter: ITER, data: await encryptJSON(key, data) });
}

/** Lee un archivo del equipo: qué es y, con el código correcto, lo que trae. */
export function peekTeamFile(text: string): Kind | null {
  try {
    const o = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as Record<string, unknown>;
    return o.app === APP && (o.kind === 'coach-summary' || o.kind === 'coach-note') ? o.kind : null;
  } catch {
    return null;
  }
}

export async function openTeamFile(text: string, code: string): Promise<{ kind: Kind; data: unknown } | null> {
  try {
    const o = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as Record<string, unknown>;
    if (o.app !== APP || (o.kind !== 'coach-summary' && o.kind !== 'coach-note') || typeof o.salt !== 'string' || !isWrapped(o.data)) return null;
    const key = await deriveKey(code.trim(), fromB64(o.salt), typeof o.iter === 'number' ? o.iter : ITER);
    return { kind: o.kind, data: await decryptJSON(key, o.data) };
  } catch {
    return null;
  }
}

export function teamFileName(kind: Kind, name: string, today: ISODate): string {
  const who = name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'equipo';
  return kind === 'coach-summary' ? `resumen-${who}-${today}.txt` : `reto-${who}-${today}.txt`;
}
