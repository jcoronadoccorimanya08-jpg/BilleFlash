/**
 * Puente con el widget de Android (app «Rachas»). Solo funciona cuando BilleFlash se abre desde esa app:
 * Chrome le entrega a la página un canal (postMessage con un MessagePort) y por ahí mandamos lo que muestra el
 * widget: racha, montaña, gastado/límite, lo que queda de la quincena y lo urgente. En modo discreto, sin montos.
 */
import { useSyncExternalStore } from 'react';
import { addDays, appDay, diffDays, type ISODate } from './dates';
import { alerts, antojosLeft, dayStatus, mainGoal, mountain, quincenaStatus, spentOn, streak } from './engine';
import type { Accent, AppState } from './types';

export interface WidgetFrame {
  today: ISODate;
  /** Día desde que empezaste (1 = el primero; 0 = todavía no empiezas). */
  dayNumber: number;
  streak: number;
  /** Ya cerraste hoy y con qué porcentaje (null si todavía no). */
  closedPct: number | null;
  /** Montaña: % de cada noche (w: cerrada). */
  days: { d: ISODate; p: number; w: boolean }[];
  /** Montos en Bs. En modo discreto van en null. */
  spent: number | null;
  limit: number | null;
  available: number | null;
  /** Días para la próxima quincena (null si no registraste ninguna). */
  nextIn: number | null;
  /** Gastado / límite en %, para la barra (sí va en modo discreto: no dice montos). */
  usePct: number;
  /** Lo más urgente, en corto («Cobrar a …», «Internet atrasado»). */
  urgent: string | null;
  /** Para antojos te quedan (Bs). En modo discreto, null. */
  antojos: number | null;
  /** Tu meta principal: % siempre; nombre y montos solo sin modo discreto. */
  goal: { pct: number; name: string | null; saved: number | null; target: number | null } | null;
}

export interface WidgetPayload extends WidgetFrame {
  v: 1;
  app: 'billeflash';
  accent: Accent;
  /** Moneda principal: «BOB» o «PEN» (para escribir Bs o S/). */
  cur: 'BOB' | 'PEN';
  /** Hora del aviso de la noche («HH:MM»). */
  remindAt: string;
  discreet: boolean;
  /** Mañana y pasado mañana tal como se verían sin abrir la app: así el widget cambia de día solo. */
  ahead: WidgetFrame[];
}

export function buildWidgetFrame(state: AppState, now: Date): WidgetFrame {
  const today = appDay(now);
  const q = quincenaStatus(state, today);
  const st = dayStatus(state, today, now);
  const spent = spentOn(state, today);
  const hide = state.settings.discreet;
  const first = alerts(state, today)[0];
  const g = mainGoal(state);
  return {
    today,
    dayNumber: today < state.settings.startDate ? 0 : diffDays(state.settings.startDate, today) + 1,
    streak: streak(state, now),
    closedPct: st.kind === 'closed' ? st.pct : null,
    days: mountain(state, now).map((m) => ({ d: m.date, p: m.pct, w: m.closed })),
    spent: hide ? null : spent,
    limit: hide ? null : q.limit,
    available: hide || !q.q ? null : q.available,
    nextIn: q.nextIn,
    usePct: q.limit > 0 ? Math.round((spent / q.limit) * 100) : 0,
    urgent: first ? (hide ? first.short.replace(/\s*\(.*\)/, '') : first.short) : null,
    antojos: hide || !(q.limit > 0) || spent > q.limit ? null : antojosLeft(state, today).left,
    goal: g ? { pct: g.target > 0 ? Math.min(100, Math.round((g.saved / g.target) * 100)) : 0, name: hide ? null : g.name, saved: hide ? null : g.saved, target: hide ? null : g.target } : null,
  };
}

/** Cuántos días adelantados se mandan (por si no abres la app). */
export const AHEAD_DAYS = 2;

export function buildWidgetPayload(state: AppState, now: Date): WidgetPayload {
  const base = new Date(now);
  return {
    v: 1,
    app: 'billeflash',
    ...buildWidgetFrame(state, now),
    accent: state.settings.accent ?? 'verde',
    discreet: state.settings.discreet,
    cur: state.settings.mainCurrency ?? 'BOB',
    remindAt: state.settings.remindAt ?? '22:30',
    ahead: Array.from({ length: AHEAD_DAYS }, (_, i) => {
      // Las 12:00 de ese día: así el «día de la app» es justo ese.
      const day = addDays(appDay(base), i + 1);
      return buildWidgetFrame(state, new Date(`${day}T16:00:00Z`));
    }),
  };
}

// ---------- Canal con la app «Rachas» ----------
/** Paquete de la app nativa «Rachas». */
const APP_PACKAGE = 'io.github.jcoronadoccorimanya08.rachas';

/**
 * ¿El origen es el de Chrome hablando en nombre de la app «Rachas»? Chrome actual lo manda como
 * «android-app://<sitio>» (el origen solo guarda el sitio, sin el paquete); versiones anteriores, como
 * «android-app://<sitio>/<paquete>» o «android-app://<paquete>». Chrome solo abre este canal a una app que
 * assetlinks.json verifica para este sitio, y ahí solo está Rachas. Una página web no puede fingir este origen.
 */
export function isRachasOrigin(origin: string, self: string): boolean {
  if (origin === self) return true;
  if (!origin.startsWith('android-app://')) return false;
  const parts = origin.slice('android-app://'.length).split(/[/?#]/);
  let host = '';
  try {
    host = new URL(self).host;
  } catch {
    /* sin sitio propio */
  }
  return parts.includes(APP_PACKAGE) || (host !== '' && parts[0] === host);
}

/** El primer mensaje del canal: lo manda Chrome (sin ventana de origen), con un solo puerto y con el origen de Rachas. */
export function isRachasChannel(e: { origin: string; source: unknown; ports: readonly unknown[] | null }, self: string): boolean {
  return e.source === null && !!e.ports && e.ports.length === 1 && isRachasOrigin(e.origin, self);
}

/** off: no hay app nativa · connecting: llegó el canal · ready: la app respondió · saved: el widget guardó tu resumen. */
export type BridgeStatus = 'off' | 'connecting' | 'ready' | 'saved';

let port: MessagePort | null = null;
let last: string | null = null;
let started = false;
let status: BridgeStatus = 'off';
const listeners = new Set<() => void>();

function setStatus(next: BridgeStatus) {
  if (status === next) return;
  status = next;
  for (const f of listeners) f();
}

/** Estado del canal con el widget, para mostrarlo en Ajustes. */
export function useBridgeStatus(): BridgeStatus {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => status,
    () => 'off',
  );
}

/** Escucha el canal de la app nativa. Se llama al cargar la página, antes de que Chrome entregue el puerto. */
export function initWidgetBridge(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('message', (e: MessageEvent) => {
    if (!isRachasChannel(e, window.location.origin)) return;
    port = e.ports[0]!;
    port.onmessage = (m: MessageEvent) => {
      const text = typeof m.data === 'string' ? m.data : '';
      if (text.startsWith('rachas:ok')) {
        setStatus('saved');
      } else if (text.startsWith('rachas:')) {
        // «hola»: la app ya escucha. Lo que se mandó antes pudo perderse, así que se manda otra vez.
        if (status !== 'saved') setStatus('ready');
        if (last) sendRaw(last);
      }
    };
    setStatus('connecting');
    if (last) sendRaw(last);
  });
}

/** Paquete con el que Chrome abre la app desde «Rachas» (document.referrer). */
const RACHAS_REFERRER = `android-app://${APP_PACKAGE}`;

export type WidgetHintKind = 'outside' | 'failed' | null;

/**
 * ¿Avisar que el widget no se actualiza? Solo en Android, abierta como app, si pasados unos segundos no llegó
 * el canal: «outside» si se abrió sin pasar por Rachas (por ejemplo, con el ícono que instaló Chrome),
 * «failed» si se abrió desde Rachas y aun así no conectó.
 */
export function widgetHint(o: { android: boolean; standalone: boolean; waited: boolean; status: BridgeStatus; referrer: string }): WidgetHintKind {
  if (!o.android || !o.standalone || !o.waited || o.status !== 'off') return null;
  return o.referrer.startsWith(RACHAS_REFERRER) ? 'failed' : 'outside';
}

function sendRaw(msg: string) {
  try {
    port?.postMessage(msg);
  } catch {
    port = null;
  }
}

export function sendWidget(payload: WidgetPayload): void {
  last = JSON.stringify(payload);
  sendRaw(last);
}
