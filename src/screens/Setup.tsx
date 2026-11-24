import { useRef, useState, type ReactNode } from 'react';
import { AmountField } from '../components/bf';
import { Icon } from '../components/Icon';
import { InstallCard } from '../components/InstallCard';
import { PatternPad } from '../components/PatternPad';
import { parseFile, type ConfigData } from '../lib/backup';
import { APP_NAME } from '../lib/config';
import type { ISODate } from '../lib/dates';
import { capital, money, parseAmount, setMainCurrency } from '../lib/engine';
import { toast } from '../lib/feedback';
import { createVault, initialState, openBackup, type StartData } from '../lib/store';
import type { VaultRecord } from '../lib/vault';

type Step = { kind: 'welcome' } | { kind: 'manual' } | { kind: 'pattern'; data: StartData; first?: string } | { kind: 'backup'; record: Pick<VaultRecord, 'lock' | 'data'> };

export function Setup({ today, updateBanner }: { today: ISODate; updateBanner?: ReactNode }) {
  const [step, setStep] = useState<Step>({ kind: 'welcome' });
  const [paste, setPaste] = useState<string | null>(null);
  const [err, setErr] = useState<string>();
  const [reset, setReset] = useState(0);
  const [qAmount, setQAmount] = useState('');
  const [qSaving, setQSaving] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const read = (text: string) => {
    try {
      const f = parseFile(text);
      if (f.kind === 'backup') setStep({ kind: 'backup', record: f.record });
      else {
        const { kind: _k, ...cfg } = f;
        void _k;
        const data: StartData = { startDate: today, ...(cfg as ConfigData) };
        setMainCurrency(data.mainCurrency ?? 'BOB');
        const c = capital(initialState(data));
        toast(`Archivo leído: capital ${money(c.capital)}.`, 'success');
        setStep({ kind: 'pattern', data });
      }
      setPaste(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Archivo inválido.', 'error');
    }
  };

  if (step.kind === 'pattern' || step.kind === 'backup') {
    const isBackup = step.kind === 'backup';
    const title = isBackup ? 'Patrón del respaldo' : step.first ? 'Repite tu patrón' : 'Crea tu patrón';
    return (
      <main className="lock">
        {updateBanner}
        <h1>{title}</h1>
        <p>{isBackup ? 'El que tenías cuando hiciste el respaldo. Será también tu patrón aquí.' : 'Une al menos 4 puntos. Con él se cifran tus datos: nadie más los puede ver.'}</p>
        <PatternPad
          resetKey={reset}
          error={Boolean(err)}
          onComplete={async (p) => {
            if (step.kind === 'backup') {
              const st = await openBackup(step.record, p);
              if (!st) {
                setErr('Patrón incorrecto.');
                setReset((r) => r + 1);
                return;
              }
              await createVault(p, st);
              return;
            }
            if (p.split('-').length < 4) {
              setErr('Une al menos 4 puntos.');
              setReset((r) => r + 1);
              return;
            }
            if (!step.first) {
              setErr(undefined);
              setStep({ ...step, first: p });
              setReset((r) => r + 1);
              return;
            }
            if (p !== step.first) {
              setErr('No coincide. Empecemos otra vez.');
              setStep({ ...step, first: undefined });
              setReset((r) => r + 1);
              return;
            }
            await createVault(p, initialState(step.data));
          }}
        />
        <p className="pin-error" role="alert">
          {err ?? ''}
        </p>
        <button type="button" className="link-btn" onClick={() => setStep({ kind: 'welcome' })}>
          Volver
        </button>
      </main>
    );
  }

  if (step.kind === 'manual') {
    const a = parseAmount(qAmount);
    const sv = qSaving.trim() ? (parseAmount(qSaving) ?? 0) : 0;
    return (
      <main className="screen onb">
        <h1 className="onb-title">Tu quincena</h1>
        <p className="muted">Con esto sale tu límite de cada día. Tus cuentas, deudas y pagos los agregas después.</p>
        <AmountField value={qAmount} onChange={setQAmount} label="Cuánto te llega cada quincena (Bs)" autoFocus />
        <AmountField value={qSaving} onChange={setQSaving} label="Cuánto quieres ahorrar de cada una (Bs)" />
        {a && <p className="fine">Tu límite: {money((a - Math.min(sv, a)) / 15)} por día durante 15 días.</p>}
        <button type="button" className="btn primary" disabled={!a} onClick={() => setStep({ kind: 'pattern', data: { startDate: today, quincena: { amount: a!, saving: Math.min(sv, a!), days: 15 } } })}>
          Seguir
        </button>
        <button type="button" className="link-btn" onClick={() => setStep({ kind: 'welcome' })}>
          Volver
        </button>
      </main>
    );
  }

  return (
    <main className="screen onb">
      {updateBanner}
      <img className="onb-logo" src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" width={72} height={72} />
      <h1 className="onb-title">{APP_NAME}</h1>
      <p className="muted">Tu billetera rápida: anotas en segundos, ves tu límite del día, tus cuentas, lo que te deben y lo que tienes que pagar. Todo cifrado y solo en este teléfono.</p>
      <button type="button" className="btn primary" onClick={() => fileRef.current?.click()}>
        <Icon name="upload" /> Cargar mi archivo de inicio
      </button>
      <button type="button" className="btn" onClick={() => setPaste('')}>
        Pegar el texto del archivo o de un respaldo
      </button>
      {paste !== null && (
        <div className="stack">
          <textarea className="field" rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Pega aquí todo el texto (empieza con «{»)" />
          <button type="button" className="btn primary" disabled={!paste.trim()} onClick={() => read(paste)}>
            Abrir
          </button>
        </div>
      )}
      <button type="button" className="btn ghost" onClick={() => setStep({ kind: 'manual' })}>
        Empezar desde cero
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".txt,.json,text/plain,application/json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) read(await f.text());
        }}
      />
      <InstallCard appName={APP_NAME} />
    </main>
  );
}
