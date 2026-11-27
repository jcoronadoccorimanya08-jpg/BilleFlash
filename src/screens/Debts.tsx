import { useState } from 'react';
import { AmountField, PayForm } from '../components/bf';
import { Icon } from '../components/Icon';
import { ConfirmDialog, ScreenHeader, SectionTitle, Sheet } from '../components/ui';
import { CURRENCY_SIGN } from '../lib/config';
import { formatShort, type ISODate } from '../lib/dates';
import { capital, collectMessage, debtLeft, debtPaid, money, nextInstallment, parseAmount, whatsappLink } from '../lib/engine';
import { toast } from '../lib/feedback';
import { actions } from '../lib/store';
import type { AppState, Currency, Debt } from '../lib/types';

export function DebtsScreen({ state, today }: { state: AppState; today: ISODate }) {
  const c = capital(state);
  const [pay, setPay] = useState<Debt | null>(null);
  const [edit, setEdit] = useState<Debt | 'new-me-deben' | 'new-debo' | null>(null);
  const open = (dir: Debt['dir']) => state.debts.filter((d) => d.dir === dir && debtLeft(d) > 0);
  const done = state.debts.filter((d) => debtLeft(d) <= 0);

  const card = (d: Debt) => {
    const left = debtLeft(d);
    const inst = nextInstallment(d, today);
    const pct = d.amount > 0 ? Math.min(100, (debtPaid(d) / d.amount) * 100) : 0;
    return (
      <div key={d.id} className="card bf-debt">
        <div className="bf-debt-head">
          <div>
            <b>{d.person}</b>
            {d.note && <span className="muted"> · {d.note}</span>}
          </div>
          <button type="button" className="icon-btn" aria-label={`Editar ${d.person}`} onClick={() => setEdit(d)}>
            <Icon name="pencil" size={18} />
          </button>
        </div>
        <div className="bf-debt-amt">
          <b>{money(left, d.currency)}</b>
          <span className="muted"> de {money(d.amount, d.currency)}</span>
        </div>
        <div className="bf-bar ok" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </div>
        {inst ? (
          <p className={`fine ${inst.inDays < 0 ? 'over' : ''}`}>
            Próxima cuota: {money(inst.amount, d.currency)} · {inst.inDays < 0 ? `atrasada desde el ${formatShort(inst.date)}` : inst.inDays === 0 ? 'hoy' : `el ${formatShort(inst.date)}`}
          </p>
        ) : (
          <p className="fine muted">Sin plan de cuotas. Tócale el lápiz para ponerle uno.</p>
        )}
        <div className="btn-row">
          <button type="button" className="btn primary" onClick={() => setPay(d)}>
            {d.dir === 'me-deben' ? 'Me pagó' : 'Pagué'}
          </button>
          {d.dir === 'me-deben' && (
            <a className="btn" href={whatsappLink(collectMessage(d, today))} target="_blank" rel="noopener noreferrer">
              <Icon name="phone" size={18} /> Cobrar por WhatsApp
            </a>
          )}
        </div>
      </div>
    );
  };

  return (
    <main className="screen">
      <ScreenHeader eyebrow="Cada una en su moneda" title="Deudas" />
      <SectionTitle aside={money(c.meDeben)}>Me deben</SectionTitle>
      {open('me-deben').map(card)}
      <button type="button" className="btn ghost" onClick={() => setEdit('new-me-deben')}>
        <Icon name="plus" size={18} /> Alguien me debe
      </button>
      <SectionTitle aside={money(c.debo)}>Debo</SectionTitle>
      {open('debo').map(card)}
      <button type="button" className="btn ghost" onClick={() => setEdit('new-debo')}>
        <Icon name="plus" size={18} /> Yo debo
      </button>
      {done.length > 0 && (
        <>
          <SectionTitle>Saldadas</SectionTitle>
          <div className="card list">
            {done.map((d) => (
              <div key={d.id} className="item">
                <span className="txt">
                  <b>{d.person}</b>
                  <span>
                    {d.dir === 'me-deben' ? 'Te pagó' : 'Pagaste'} {money(d.amount, d.currency)}
                  </span>
                </span>
                <Icon name="check" />
              </div>
            ))}
          </div>
        </>
      )}

      <Sheet open={Boolean(pay)} title={pay ? (pay.dir === 'me-deben' ? `${pay.person} te pagó` : `Le pagaste a ${pay.person}`) : ''} onClose={() => setPay(null)}>
        {pay && (
          <PayForm
            state={state}
            initial={nextInstallment(pay, today)?.amount ?? debtLeft(pay)}
            currency={pay.currency}
            accountLabelText={pay.dir === 'me-deben' ? '¿Cómo te pagó? (QR al banco o en efectivo)' : '¿De dónde salió?'}
            defaultAccount={pay.dir === 'me-deben' ? state.settings.lastCollectAccount : undefined}
            allowNone
            confirm="Registrar"
            onDone={(amount, acc) => {
              actions.payDebt(pay.id, today, Math.min(amount, debtLeft(pay)), acc);
              toast(amount >= debtLeft(pay) ? '¡Deuda saldada!' : 'Pago registrado.', amount >= debtLeft(pay) ? 'reward' : 'success');
              setPay(null);
            }}
          />
        )}
      </Sheet>
      <Sheet open={Boolean(edit)} title={edit && typeof edit !== 'string' ? `Editar: ${edit.person}` : edit === 'new-debo' ? 'Yo debo' : 'Alguien me debe'} onClose={() => setEdit(null)}>
        {edit && <DebtForm today={today} debt={typeof edit === 'string' ? null : edit} dir={typeof edit === 'string' ? (edit === 'new-debo' ? 'debo' : 'me-deben') : edit.dir} onDone={() => setEdit(null)} />}
      </Sheet>
    </main>
  );
}

const EVERY: [number, string][] = [
  [7, 'Cada semana'],
  [15, 'Cada 15 días'],
  [30, 'Cada mes'],
];

function DebtForm({ today, debt, dir, onDone }: { today: ISODate; debt: Debt | null; dir: Debt['dir']; onDone: () => void }) {
  const [person, setPerson] = useState(debt?.person ?? '');
  const [note, setNote] = useState(debt?.note ?? '');
  const [currency, setCurrency] = useState<Currency>(debt?.currency ?? 'PEN');
  const [amount, setAmount] = useState(debt ? String(debt.amount) : '');
  const [hasPlan, setHasPlan] = useState(Boolean(debt?.plan));
  const [planAmount, setPlanAmount] = useState(debt?.plan ? String(debt.plan.amount) : '');
  const [every, setEvery] = useState(debt?.plan?.everyDays ?? 7);
  const [start, setStart] = useState(debt?.plan?.start ?? today);
  const [del, setDel] = useState(false);
  const n = parseAmount(amount);
  const p = parseAmount(planAmount);
  const ok = person.trim() && n && (!hasPlan || p);

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        const data = { dir, person: person.trim(), currency, amount: n!, ...(note.trim() ? { note: note.trim() } : {}), plan: hasPlan && p ? { amount: p, everyDays: every, start } : undefined };
        if (debt) actions.updateDebt(debt.id, data);
        else actions.addDebt(data);
        onDone();
      }}
    >
      <label className="lbl-field">
        <span>Persona</span>
        <input className="field" value={person} onChange={(e) => setPerson(e.target.value)} placeholder="Nombre" />
      </label>
      <div className="segmented" role="radiogroup" aria-label="Moneda">
        {(['PEN', 'BOB'] as Currency[]).map((c) => (
          <button key={c} type="button" role="radio" aria-checked={currency === c} onClick={() => setCurrency(c)}>
            {c === 'BOB' ? 'Bolivianos' : 'Soles'}
          </button>
        ))}
      </div>
      <AmountField value={amount} onChange={setAmount} label={`Monto total (${CURRENCY_SIGN[currency]})`} />
      <label className="lbl-field">
        <span>Nota (opcional)</span>
        <input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Devolver en soles, mitad de…" />
      </label>
      <label className="bf-check">
        <input type="checkbox" checked={hasPlan} onChange={(e) => setHasPlan(e.target.checked)} />
        <span>Con plan de cuotas</span>
      </label>
      {hasPlan && (
        <>
          <AmountField value={planAmount} onChange={setPlanAmount} label={`Cada cuota (${CURRENCY_SIGN[currency]})`} />
          <div className="segmented" role="radiogroup" aria-label="Cada cuánto">
            {EVERY.map(([d, l]) => (
              <button key={d} type="button" role="radio" aria-checked={every === d} onClick={() => setEvery(d)}>
                {l}
              </button>
            ))}
          </div>
          <label className="lbl-field">
            <span>Primera cuota</span>
            <input className="field" type="date" value={start} onChange={(e) => setStart(e.target.value || start)} />
          </label>
        </>
      )}
      <button type="submit" className="btn primary" disabled={!ok}>
        Guardar
      </button>
      {debt && (
        <button type="button" className="btn danger" onClick={() => setDel(true)}>
          <Icon name="trash" size={18} /> Quitar esta deuda
        </button>
      )}
      <ConfirmDialog
        open={del}
        onClose={() => setDel(false)}
        title="¿Quitar esta deuda?"
        body="Se borra con sus pagos. Lo que ya entró o salió de tus cuentas se queda como está."
        confirmLabel="Quitar"
        danger
        onConfirm={() => {
          if (debt) actions.deleteDebt(debt.id);
          onDone();
        }}
      />
    </form>
  );
}
