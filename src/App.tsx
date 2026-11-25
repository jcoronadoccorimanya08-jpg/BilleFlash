import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { sync } from './lib/syncSetup';
import { ConfettiHost } from './components/Confetti';
import { BottomNav, ToastHost, type Tab } from './components/ui';
import { UpdateBanner, useServiceWorker } from './components/UpdateBanner';
import { WidgetHint } from './components/WidgetHint';
import { canShareFiles, downloadBackupText, serializeBackup, shareBackupText } from './lib/backup';
import { alerts, billStatus, mainOf, nextInstallment, setMainCurrency } from './lib/engine';
import { toast } from './lib/feedback';
import { useMediaQuery, useToday } from './lib/hooks';
import { applyLook, readLook, type Look } from './lib/look';
import { actions, currentBackup, getState, lock, onSaveError, useStore } from './lib/store';
import { buildWidgetPayload, sendWidget } from './lib/widget';
import { AccountsScreen } from './screens/Accounts';
import { BillsScreen } from './screens/Bills';
import { DebtsScreen } from './screens/Debts';
import { LockScreen } from './screens/Lock';
import { ProgressScreen } from './screens/Progress';
import { Setup } from './screens/Setup';
import { TodayScreen } from './screens/Today';

function useLook(look: Look) {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  useLayoutEffect(() => {
    applyLook(look, prefersDark);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [look.theme, look.accent, look.size, prefersDark]);
}

/** «Ahora», refrescado cada 30 s (para la racha y el cierre). */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    const tick = () => setNow(new Date());
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  return now;
}

export function App() {
  const sw = useServiceWorker();
  const { phase, state, hasBio } = useStore();
  const today = useToday();
  const now = useNow();
  const [tab, setTab] = useState<Tab>('hoy');
  const [curtain, setCurtain] = useState(false);
  const hiddenAt = useRef<number | null>(null);

  useLook(state ? { theme: state.settings.theme, accent: state.settings.accent ?? 'verde', size: state.settings.textSize ?? 'normal' } : readLook());
  useEffect(() => onSaveError((m) => toast(m, 'error')), []);

  // Widget de Android: si BilleFlash se abrió desde la app «Rachas», le manda el resumen.
  useEffect(() => {
    if (state) sendWidget(buildWidgetPayload(state, now));
  }, [state, now]);

  // Bloqueo automático y cortina de privacidad al salir de la app.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
        setCurtain(true);
        return;
      }
      const minutes = getState()?.settings.autoLockMinutes ?? 1;
      if (hiddenAt.current !== null && Date.now() - hiddenAt.current >= minutes * 60_000) lock();
      hiddenAt.current = null;
      setCurtain(false);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (phase !== 'unlocked') setTab('hoy');
  }, [phase]);

  // Al desbloquear: trae lo último de tu otro dispositivo (y sube lo pendiente).
  useEffect(() => {
    if (phase === 'unlocked') void sync.syncNow();
  }, [phase]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [tab]);

  const updateBanner = <UpdateBanner needRefresh={sw.needRefresh} onUpdate={sw.update} />;

  if (phase === 'loading') return <div className="app" aria-busy="true" />;
  if (phase === 'setup')
    return (
      <>
        <Setup today={today} updateBanner={updateBanner} />
        <ToastHost />
      </>
    );
  if (phase === 'locked' || !state)
    return (
      <>
        <LockScreen hasBio={hasBio} updateBanner={updateBanner} />
        <ToastHost />
      </>
    );

  const quickBackup = async () => {
    try {
      const rec = await currentBackup();
      if (!rec) return;
      const text = serializeBackup(rec);
      if (canShareFiles()) {
        if ((await shareBackupText(text)) === 'cancelled') return;
      } else downloadBackupText(text);
      actions.markBackup();
      toast('Respaldo listo. Guárdalo en Drive o mándatelo por WhatsApp.', 'success');
    } catch {
      toast('No se pudo crear el respaldo. Prueba desde Avance → Respaldo.', 'error');
    }
  };

  setMainCurrency(mainOf(state));

  const navAlerts = {
    hoy: alerts(state, today).some((a) => a.tone === 'red'),
    deudas: state.debts.some((d) => (nextInstallment(d, today)?.inDays ?? 99) <= 0),
    pagos: state.bills.some((b) => ['late', 'today'].includes(billStatus(b, today).kind)),
  };

  return (
    <>
      <div className="app">
        {updateBanner}
        <WidgetHint />
        {tab === 'hoy' && <TodayScreen state={state} today={today} now={now} onBackup={() => void quickBackup()} />}
        {tab === 'cuentas' && <AccountsScreen state={state} today={today} />}
        {tab === 'deudas' && <DebtsScreen state={state} today={today} />}
        {tab === 'pagos' && <BillsScreen state={state} today={today} />}
        {tab === 'avance' && <ProgressScreen state={state} today={today} now={now} hasBio={hasBio} />}
      </div>
      <BottomNav tab={tab} onChange={setTab} alerts={navAlerts} />
      <ToastHost />
      <ConfettiHost />
      {curtain && (
        <div className="curtain" aria-hidden="true">
          <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" />
        </div>
      )}
    </>
  );
}
