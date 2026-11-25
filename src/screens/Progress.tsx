import { useEffect, useRef, useState } from 'react';
import { AccountSelect, AmountField } from '../components/bf';
import { Icon } from '../components/Icon';
import { CapitalCurve, CategoryBars, DayBars } from '../components/Charts';
import { Mountain } from '../components/Mountain';
import { MyCoach, MyTeam } from '../components/Team';
import { PatternPad } from '../components/PatternPad';
import { ScreenHeader, SectionTitle } from '../components/ui';
import { canShareFiles, downloadBackupText, parseFile, serializeBackup, shareBackupText } from '../lib/backup';
import { addDays, diffDays, formatShort, localDateOf, type ISODate } from '../lib/dates';
import { shotBs, shotPen, bestStreak, dailyBars, dollars, money, mountain, parseAmount, quincenaSummaries, spentByCategory, streak } from '../lib/engine';
import { toast } from '../lib/feedback';
import { ACCENTS, THEMES } from '../lib/look';
import { actions, biometricSupport, changePattern, currentBackup, disableBiometric, enableBiometric, openBackup, replaceState, verifyPattern } from '../lib/store';
import type { AppState, CapitalShot } from '../lib/types';
import type { VaultRecord } from '../lib/vault';

/** Tu tabla amarilla, pero sola: cada foto de tu capital, en orden, con cuánto subió o bajó. */
function CapitalHistory({ state, today }: { state: AppState; today: ISODate }) {
  const shots = state.shots;
  const [all, setAll] = useState(false);
  const first = shots[0];
  const last = shots[shots.length - 1];
  const rows = shots.map((s, i) => ({ s, n: i + 1, diff: i > 0 ? s.capital - shots[i - 1]!.capital : null })).reverse();
  const shown = all ? rows : rows.slice(0, 10);
  const pen = (s: CapitalShot) => shotPen(s);
  // En dólares: con el tipo de esa foto o, si no tenía, con el de hoy.
  const usdRate = state.settings.usdRate;
  const usd = (s: CapitalShot) => (s.usd ?? usdRate ? dollars(pen(s) / (s.usd ?? usdRate)!) : '$ —');
  const total = first && last ? last.capital - first.capital : 0;
  return (
    <>
      <SectionTitle aside={`${shots.length} ${shots.length === 1 ? 'foto' : 'fotos'}`}>Historial de tu capital</SectionTitle>
      <section className="card">
        {last ? (
          <>
            <div className="bf-hist-top">
              <div>
                <span className="muted">Hoy tienes</span>
                <b>{money(last.capital)}</b>
                <small className="muted">
                  {money(pen(last), 'PEN')}
                  {` · ${usd(last)}`}
                </small>
              </div>
              {shots.length > 1 && (
                <div className="bf-right">
                  <span className="muted">Desde que empezaste</span>
                  <b className={total >= 0 ? 'ok' : 'over'}>
                    {total >= 0 ? '+' : '−'}
                    {money(Math.abs(total))}
                  </b>
                </div>
              )}
            </div>
            <CapitalCurve shots={shots} usdRate={state.settings.usdRate} />
          </>
        ) : (
          <p className="muted">Todavía no hay fotos de tu capital.</p>
        )}
        <button
          type="button"
          className="btn"
          onClick={() => {
            actions.snapshot(today);
            toast('Foto de tu capital guardada.', 'success');
          }}
        >
          <Icon name="image" size={18} /> Anotar mi capital ahora
        </button>
      </section>
      {rows.length > 0 && (
        <div className="card bf-hist-wrap">
          <table className="bf-hist">
            <thead>
              <tr>
                <th>N°</th>
                <th>Fecha</th>
                <th>Hora</th>
                <th>Capital Bs</th>
                <th>Capital S/</th>
                <th>Capital $</th>
                <th>Cambio</th>
                <th>En mano</th>
                <th>Te deben</th>
                <th>Debes</th>
                <th>TC</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ s, n, diff }) => (
                <tr key={n}>
                  <td>{n}</td>
                  <td>{s.date.slice(8, 10)}/{s.date.slice(5, 7)}/{s.date.slice(2, 4)}</td>
                  <td>{s.time}</td>
                  <td>
                    <b>{money(shotBs(s), 'BOB')}</b>
                  </td>
                  <td>{money(pen(s), 'PEN')}</td>
                  <td>{usd(s)}</td>
                  <td className={diff === null ? 'muted' : diff >= 0 ? 'ok' : 'over'}>{diff === null ? 'inicio' : `${diff >= 0 ? '+' : '−'}${money(Math.abs(diff))}`}</td>
                  <td>{money(s.enMano)}</td>
                  <td>{money(s.meDeben)}</td>
                  <td>{money(s.debo)}</td>
                  <td>{s.rate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 10 && (
        <button type="button" className="btn ghost" onClick={() => setAll(!all)}>
          {all ? 'Ver solo las últimas 10' : `Ver las ${rows.length} fotos`}
        </button>
      )}
      <p className="fine">Desliza la tabla hacia los lados para ver todas las columnas. Capital = en mano + te deben − debes.</p>
    </>
  );
}

/** Tu quincena: en qué se te va, cada día contra tu límite y el resumen de las anteriores. */
function QuincenaSection({ state, today, now }: { state: AppState; today: ISODate; now: Date }) {
  const list = quincenaSummaries(state, today, now);
  const cur = list[0];
  const from = cur?.from ?? addDays(today, -14);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <SectionTitle aside={cur ? `desde el ${formatShort(cur.from)}` : 'últimos 15 días'}>Tu quincena</SectionTitle>
      {cur && (
        <div className="tiles">
          <div className="tile">
            <b>{money(cur.spent)}</b>
            <span>Gastado de {money(cur.budget)}</span>
          </div>
          <div className="tile">
            <b>
              {cur.daysWithin}
              <small>/{cur.days}</small>
            </b>
            <span>Días dentro del límite</span>
          </div>
        </div>
      )}
      <section className="card">
        <h2 className="card-title">¿En qué se te va?</h2>
        <CategoryBars data={spentByCategory(state, from, today)} />
      </section>
      <section className="card">
        <h2 className="card-title">Cada día contra tu límite</h2>
        <DayBars data={dailyBars(state, today, 14)} />
      </section>
      {list.length > 1 && (
        <>
          <SectionTitle>Quincenas anteriores</SectionTitle>
          <div className="card list">
            {list.slice(1).map((r) => (
              <div key={r.q.id} className="item col">
                <button type="button" className="bf-acc" onClick={() => setOpen(open === r.q.id ? null : r.q.id)} aria-expanded={open === r.q.id}>
                  <span className="txt">
                    <b>
                      {formatShort(r.from)} al {formatShort(r.to)}
                    </b>
                    <span>
                      Gastaste {money(r.spent)} de {money(r.budget)} · ahorraste {money(r.saving)} · {r.daysWithin}/{r.days} días dentro · {r.nightsClosed} noches cerradas
                    </span>
                  </span>
                </button>
                {open === r.q.id && <CategoryBars data={r.byCategory} />}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

export function ProgressScreen({ state, today, now, hasBio }: { state: AppState; today: ISODate; now: Date; hasBio: boolean }) {
  const m = mountain(state, now);
  const avgOf = (i: number) => {
    const w = m.slice(Math.max(0, i - 6), i + 1);
    return w.reduce((s, x) => s + x.pct, 0) / w.length;
  };
  const data = m.map((x, i) => ({ date: x.date, pct: x.pct, avg7: avgOf(i), won: x.closed }));
  return (
    <main className="screen">
      <ScreenHeader eyebrow="Tu hábito de revisar" title="Avance" />
      <div className="tiles">
        <div className="tile">
          <b>{streak(state, now)}</b>
          <span>Noches seguidas</span>
        </div>
        <div className="tile">
          <b>{bestStreak(state, now)}</b>
          <span>Tu mejor racha</span>
        </div>
      </div>
      <section className="card">
        <h2 className="card-title">Tu montaña</h2>
        {data.length ? <Mountain data={data} goal={100} /> : <p className="muted">Empieza cerrando tu primera noche.</p>}
        <p className="fine">100 %: cerraste antes de medianoche. 75 %: de madrugada. Cada olvido resta 15 %.</p>
      </section>

      <QuincenaSection state={state} today={today} now={now} />

      <CapitalHistory state={state} today={today} />

      <MyCoach state={state} now={now} />

      <MyTeam state={state} today={today} />

      <Settings state={state} today={today} hasBio={hasBio} />
    </main>
  );
}

/** Mi plata: moneda principal, cómo te llega (quincena o libre), límite, % al ahorro y la hora del aviso. */
function MoneyPrefs({ state }: { state: AppState }) {
  const s = state.settings;
  const [cur, setCur] = useState(s.mainCurrency ?? 'BOB');
  const [mode, setMode] = useState(s.incomeMode ?? 'quincena');
  const [limit, setLimit] = useState(String(s.dailyLimit ?? ''));
  const [pct, setPct] = useState(String(s.savingPct ?? 10));
  const [at, setAt] = useState(s.remindAt ?? '22:30');
  return (
    <>
      <SectionTitle>Mi plata</SectionTitle>
      <section className="card stack">
        <div className="segmented" role="radiogroup" aria-label="Moneda principal">
          {(
            [
              ['BOB', 'Bolivianos'],
              ['PEN', 'Soles'],
            ] as const
          ).map(([c, l]) => (
            <button key={c} type="button" role="radio" aria-checked={cur === c} onClick={() => setCur(c)}>
              {l}
            </button>
          ))}
        </div>
        <div className="segmented" role="radiogroup" aria-label="Cómo te llega la plata">
          <button type="button" role="radio" aria-checked={mode === 'quincena'} onClick={() => setMode('quincena')}>
            Quincena fija
          </button>
          <button type="button" role="radio" aria-checked={mode === 'libre'} onClick={() => setMode('libre')}>
            Cuando me dan
          </button>
        </div>
        {mode === 'libre' && (
          <>
            <AmountField value={limit} onChange={setLimit} label={`Mi límite de cada día (${cur === 'PEN' ? 'S/' : 'Bs'})`} />
            <AmountField value={pct} onChange={setPct} label="% de cada plata que va solo a mi alcancía" />
          </>
        )}
        <label className="lbl-field">
          <span>Hora del aviso de la noche (en el widget)</span>
          <input className="field" type="time" value={at} onChange={(e) => setAt(e.target.value || at)} />
        </label>
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            actions.setMoneyPrefs({ mainCurrency: cur, incomeMode: mode, dailyLimit: parseAmount(limit) ?? 0, savingPct: Math.min(100, Math.max(0, Number(pct.replace(',', '.')) || 0)), remindAt: at });
            toast('Guardado.', 'success');
          }}
        >
          Guardar
        </button>
      </section>
    </>
  );
}

type Overlay = { kind: 'change' } | { kind: 'backup'; record: Pick<VaultRecord, 'lock' | 'data'> } | null;

function Settings({ state, today, hasBio }: { state: AppState; today: ISODate; hasBio: boolean }) {
  const s = state.settings;
  const [qAmount, setQAmount] = useState(String(s.quincena.amount || ''));
  const [qSaving, setQSaving] = useState(String(s.quincena.saving || ''));
  const [qDays, setQDays] = useState(String(s.quincena.days));
  const [carry, setCarry] = useState(String(s.carryStart || ''));
  const [nick, setNick] = useState(s.nick ?? '');
  const [bio, setBio] = useState<'yes' | 'maybe' | 'no'>('maybe');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [paste, setPaste] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void biometricSupport().then(setBio);
  }, []);

  const backup = async (mode: 'share' | 'copy') => {
    try {
      const rec = await currentBackup();
      if (!rec) return;
      const text = serializeBackup(rec);
      if (mode === 'copy') await navigator.clipboard.writeText(text);
      else if (canShareFiles()) {
        if ((await shareBackupText(text)) === 'cancelled') return;
      } else downloadBackupText(text);
      actions.markBackup();
      toast(mode === 'copy' ? 'Respaldo copiado. Pégalo en una nota privada o en Drive.' : 'Respaldo listo.', 'success');
    } catch {
      toast('No se pudo crear el respaldo. Prueba con «Copiar».', 'error');
    }
  };

  const readText = (text: string) => {
    try {
      const f = parseFile(text);
      if (f.kind === 'backup') setOverlay({ kind: 'backup', record: f.record });
      else toast('Ese es un archivo de inicio: se usa solo al crear la app.', 'neutral');
      setPaste(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Archivo inválido.', 'error');
    }
  };

  const last = s.lastBackupAt ? localDateOf(s.lastBackupAt) : null;
  const qa = parseAmount(qAmount) ?? 0;
  const qs = qSaving.trim() === '' ? 0 : (parseAmount(qSaving) ?? 0);
  const qd = Math.max(1, Math.round(Number(qDays) || 15));

  const sign = s.mainCurrency === 'PEN' ? 'S/' : 'Bs';
  return (
    <>
      <MoneyPrefs state={state} />
      {s.incomeMode !== 'libre' && (
        <>
      <SectionTitle>Mi quincena</SectionTitle>
      <section className="card stack">
        <AmountField value={qAmount} onChange={setQAmount} label={`Cuánto llega (${sign})`} />
        <AmountField value={qSaving} onChange={setQSaving} label={`Cuánto va al ahorro (${sign})`} />
        <AmountField value={qDays} onChange={setQDays} label="Días que dura" />
        <p className="fine">Tu límite: {money(qd ? (qa - qs) / qd : 0)} por día.</p>
        <AmountField value={carry} onChange={setCarry} label={`Lo que te sobró antes de empezar (${sign})`} />
        <AccountSelect state={state} value={s.savingAccountId ?? ''} onChange={(id) => actions.setSavingAccount(id)} label="Cuenta de ahorro" />
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            actions.setQuincena({ amount: qa, saving: Math.min(qs, qa), days: qd });
            actions.setCarryStart(carry.trim() ? (parseAmount(carry) ?? 0) : 0);
            toast('Quincena guardada.', 'success');
          }}
        >
          Guardar
        </button>
      </section>
        </>
      )}

      <SectionTitle>Widget y frases</SectionTitle>
      <section className="card stack">
        <label className="bf-check">
          <input type="checkbox" checked={s.discreet} onChange={(e) => actions.setDiscreet(e.target.checked)} />
          <span>Modo discreto: el widget no muestra montos</span>
        </label>
        <label className="lbl-field">
          <span>Cómo te llamo (opcional)</span>
          <input className="field" value={nick} onChange={(e) => setNick(e.target.value)} onBlur={() => actions.setNick(nick)} />
        </label>
      </section>

      <SectionTitle>Apariencia</SectionTitle>
      <section className="card stack">
        <div className="segmented" role="radiogroup" aria-label="Tema">
          {THEMES.map(([t, l]) => (
            <button key={t} type="button" role="radio" aria-checked={s.theme === t} onClick={() => actions.setTheme(t)}>
              {l}
            </button>
          ))}
        </div>
        <div className="segmented" role="radiogroup" aria-label="Color">
          {ACCENTS.map(([a, l]) => (
            <button key={a} type="button" role="radio" aria-checked={(s.accent ?? 'verde') === a} onClick={() => actions.setAccent(a)}>
              {l}
            </button>
          ))}
        </div>
        <div className="segmented" role="radiogroup" aria-label="Letra">
          <button type="button" role="radio" aria-checked={(s.textSize ?? 'normal') === 'normal'} onClick={() => actions.setTextSize('normal')}>
            Letra normal
          </button>
          <button type="button" role="radio" aria-checked={s.textSize === 'grande'} onClick={() => actions.setTextSize('grande')}>
            Letra grande
          </button>
        </div>
      </section>

      <SectionTitle>Seguridad</SectionTitle>
      <section className="card list">
        <div className="item">
          <span className="txt">
            <b>Huella</b>
            <span>{hasBio ? 'Activada' : bio === 'no' ? 'Este teléfono no la permite aquí' : 'Entra sin dibujar el patrón'}</span>
          </span>
          {hasBio ? (
            <button type="button" className="btn sm" onClick={() => void disableBiometric().then(() => toast('Huella desactivada.'))}>
              Quitar
            </button>
          ) : bio !== 'no' ? (
            <button
              type="button"
              className="btn primary sm"
              onClick={async () => {
                try {
                  await enableBiometric();
                  toast('Huella activada.', 'success');
                } catch (e) {
                  const msg = e instanceof Error ? e.message : '';
                  toast(msg === 'NOPRF' ? 'Tu teléfono no permite usar la huella aquí.' : 'No se activó la huella.', 'error');
                  if (msg === 'NOPRF') setBio('no');
                }
              }}
            >
              <Icon name="fingerprint" size={17} /> Activar
            </button>
          ) : null}
        </div>
        <div className="item">
          <span className="txt">
            <b>Patrón</b>
            <span>Cámbialo cuando quieras</span>
          </span>
          <button type="button" className="btn sm" onClick={() => setOverlay({ kind: 'change' })}>
            Cambiar
          </button>
        </div>
        <div className="item">
          <span className="txt">
            <b>Bloqueo automático</b>
            <span>Al salir de la app</span>
          </span>
          <select className="field bf-mini" value={s.autoLockMinutes} onChange={(e) => actions.setAutoLock(Number(e.target.value))} aria-label="Bloqueo automático">
            <option value={0}>Al instante</option>
            <option value={1}>1 min</option>
            <option value={5}>5 min</option>
            <option value={15}>15 min</option>
          </select>
        </div>
      </section>

      <SectionTitle>📲 Celular ↔ tablet</SectionTitle>
      <section className="card stack">
        <p className="fine">En el dispositivo donde anotas, toca «Pasar» y elige tu otro dispositivo en Quick Share. En el otro, toca «Recibir», elige el archivo (queda en Descargas) y dibuja tu patrón: queda igual. Recibir reemplaza lo que había en ese dispositivo.</p>
        <button type="button" className="btn primary" onClick={() => void backup('share')}>
          📲 Pasar a mi otro dispositivo
        </button>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          📥 Recibir de mi otro dispositivo
        </button>
      </section>

      <SectionTitle>Respaldo</SectionTitle>
      <section className="card stack">
        <p className="fine">{!last ? 'Todavía no hiciste ningún respaldo.' : last === today ? 'Último respaldo: hoy.' : `Último respaldo: hace ${diffDays(last, today)} días.`} Va cifrado con tu patrón.</p>
        <div className="btn-row">
          <button type="button" className="btn primary" onClick={() => void backup('share')}>
            <Icon name="share" size={18} /> Compartir o guardar
          </button>
          <button type="button" className="btn" onClick={() => void backup('copy')}>
            <Icon name="copy" size={18} /> Copiar
          </button>
        </div>
        <div className="btn-row">
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={18} /> Restaurar desde archivo
          </button>
          <button type="button" className="btn" onClick={() => setPaste('')}>
            Pegar texto
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.json,text/plain,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) readText(await f.text());
          }}
        />
        {paste !== null && (
          <div className="stack">
            <textarea className="field" rows={4} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Pega aquí el texto del respaldo" />
            <button type="button" className="btn primary" disabled={!paste.trim()} onClick={() => readText(paste)}>
              Abrir
            </button>
          </div>
        )}
      </section>
      <p className="fine bf-version">BilleFlash {__APP_VERSION__} · sin servidores · tus datos solo en este teléfono</p>

      {overlay?.kind === 'change' && <ChangePattern onClose={() => setOverlay(null)} />}
      {overlay?.kind === 'backup' && (
        <BackupPattern
          record={overlay.record}
          onClose={() => setOverlay(null)}
          onOpened={(st) => {
            replaceState(st);
            setOverlay(null);
            toast('Respaldo restaurado.', 'success');
          }}
        />
      )}
    </>
  );
}

function PatternOverlay({ title, text, onClose, onPattern }: { title: string; text: string; onClose: () => void; onPattern: (p: string) => Promise<string | null> }) {
  const [err, setErr] = useState<string>();
  const [reset, setReset] = useState(0);
  const [busy, setBusy] = useState(false);
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="icon-btn overlay-close" aria-label="Cerrar" onClick={onClose}>
        <Icon name="x" />
      </button>
      <main className="lock">
        <h1>{title}</h1>
        <p>{text}</p>
        <PatternPad
          resetKey={reset}
          error={Boolean(err)}
          disabled={busy}
          onComplete={async (p) => {
            setBusy(true);
            const e = await onPattern(p);
            setBusy(false);
            setErr(e ?? undefined);
            setReset((r) => r + 1);
          }}
        />
        <p className="pin-error" role="alert">
          {busy ? 'Un momento…' : (err ?? '')}
        </p>
      </main>
    </div>
  );
}

function ChangePattern({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<'current' | 'new' | 'repeat'>('current');
  const [first, setFirst] = useState('');
  const text = step === 'current' ? 'Dibuja tu patrón actual.' : step === 'new' ? 'Dibuja el nuevo patrón.' : 'Repítelo para confirmar.';
  return (
    <PatternOverlay
      key={step}
      title="Cambiar patrón"
      text={text}
      onClose={onClose}
      onPattern={async (p) => {
        if (step === 'current') {
          if (!(await verifyPattern(p))) return 'Patrón incorrecto.';
          setStep('new');
          return null;
        }
        if (step === 'new') {
          setFirst(p);
          setStep('repeat');
          return null;
        }
        if (p !== first) {
          setStep('new');
          return 'No coincide. Dibuja otra vez el nuevo patrón.';
        }
        await changePattern(p);
        toast('Patrón actualizado. Haz un respaldo nuevo.', 'success');
        onClose();
        return null;
      }}
    />
  );
}

function BackupPattern({ record, onClose, onOpened }: { record: Pick<VaultRecord, 'lock' | 'data'>; onClose: () => void; onOpened: (s: AppState) => void }) {
  return (
    <PatternOverlay
      title="Patrón del respaldo"
      text="El que tenías cuando hiciste este respaldo."
      onClose={onClose}
      onPattern={async (p) => {
        const st = await openBackup(record, p);
        if (!st) return 'Patrón incorrecto.';
        onOpened(st);
        return null;
      }}
    />
  );
}
