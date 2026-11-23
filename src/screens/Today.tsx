import { useState } from 'react';
import { celebrate } from '../components/Confetti';
import { AccountSelect, AmountField, Money } from '../components/bf';
import { Icon } from '../components/Icon';
import { ConfirmDialog, ScreenHeader, Sheet } from '../components/ui';
import { CLOSE_PHRASES } from '../lib/config';
import { clockOf, formatLong, type ISODate } from '../lib/dates';
import { accountOf, alerts, canClose, dayStatus, money, parseAmount, quincenaStatus, spentOn, streak } from '../lib/engine';
import { haptic, toast } from '../lib/feedback';
import { actions } from '../lib/store';
import type { AppState, Expense } from '../lib/types';

const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)]!;

export function TodayScreen({ state, today, now }: { state: AppState; today: ISODate; now: Date }) {
  const s = state.settings;
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [acc, setAcc] = useState(state.accounts.find((a) => a.kind === 'efectivo')?.id ?? state.accounts[0]?.id ?? '');
  const [forgot, setForgot] = useState(false);
  const [edit, setEdit] = useState<Expense | null>(null);
  const [income, setIncome] = useState(false);
  const [askClose, setAskClose] = useState(false);

  const st = dayStatus(state, today, now);
  const closed = st.kind === 'closed';
  const list = state.expenses.filter((e) => e.date === today).sort((a, b) => a.time.localeCompare(b.time));
  const spent = spentOn(state, today);
  const q = quincenaStatus(state, today);
  const within = spent <= q.limit + 0.001;
  const usePct = q.limit > 0 ? Math.min(100, (spent / q.limit) * 100) : 0;
  const run = streak(state, now);
  const urgent = alerts(state, today);
  const n = parseAmount(amount);

  const add = () => {
    if (!n || !acc) return;
    actions.addExpense(today, { desc, amount: n, accountId: acc, forgot });
    haptic();
    if (closed || forgot) toast('Anotado como olvidado: −15 % de esta noche.', 'neutral');
    setDesc('');
    setAmount('');
    setForgot(false);
  };

  const close = () => {
    actions.closeDay(today);
    celebrate('day');
    haptic([20, 40, 20]);
    toast(pick(within ? CLOSE_PHRASES.within : CLOSE_PHRASES.over), 'reward');
  };

  return (
    <main className="screen">
      <ScreenHeader
        eyebrow={formatLong(today)}
        title={s.nick ? `Hola, ${s.nick}` : 'Hoy'}
        right={
          <div className="streak-pill" aria-label={`Racha de ${run} noches`}>
            <Icon name="flame" size={18} /> {run}
          </div>
        }
      />

      {urgent.length > 0 && (
        <div className="bf-alerts" role="list">
          {urgent.slice(0, 3).map((a, i) => (
            <div key={i} role="listitem" className={`bf-alert ${a.tone}`}>
              <Icon name="alert" size={16} /> {a.text}
            </div>
          ))}
        </div>
      )}

      <section className="card bf-limit">
        <div className="bf-limit-top">
          <div>
            <span className="muted">Gastado hoy</span>
            <b className={within ? 'ok' : 'over'}>{money(spent)}</b>
          </div>
          <div className="bf-right">
            <span className="muted">Tu límite</span>
            <b>{money(q.limit)}</b>
          </div>
        </div>
        <div className={`bf-bar ${within ? 'ok' : 'over'}`} role="progressbar" aria-valuenow={Math.round(usePct)} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${usePct}%` }} />
        </div>
        <p className="fine">
          {within ? `Te quedan ${money(Math.max(0, q.limit - spent))} hoy.` : `Te pasaste ${money(spent - q.limit)}. Sin culpa: mañana lo equilibras.`}
          {q.q ? ` Disponible en la quincena: ${money(q.available)}${q.nextIn !== null ? ` · próxima ${q.nextIn > 0 ? `en ${q.nextIn} ${q.nextIn === 1 ? 'día' : 'días'}` : q.nextIn === 0 ? 'hoy' : `atrasada ${-q.nextIn} ${q.nextIn === -1 ? 'día' : 'días'}`}` : ''}.` : ' Registra tu quincena con «Entró plata».'}
        </p>
      </section>

      <section className="card">
        <h2 className="card-title">Anotar un gasto</h2>
        <form
          className="bf-add"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input className="field" placeholder="Descripción (almuerzo, pasaje…)" value={desc} onChange={(e) => setDesc(e.target.value)} enterKeyHint="next" aria-label="Descripción" />
          <div className="bf-add-row">
            <input className="field" inputMode="decimal" placeholder="Bs 0" value={amount} onChange={(e) => setAmount(e.target.value)} enterKeyHint="done" aria-label="Costo" />
            <select className="field" value={acc} onChange={(e) => setAcc(e.target.value)} aria-label="De qué cuenta">
              {state.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <button type="submit" className="btn primary bf-plus" disabled={!n} aria-label="Agregar gasto">
              <Icon name="plus" />
            </button>
          </div>
          <label className="bf-check">
            <input type="checkbox" checked={forgot || closed} disabled={closed} onChange={(e) => setForgot(e.target.checked)} />
            <span>{closed ? 'Ya cerraste: lo que agregues cuenta como olvidado (−15 %)' : 'Me olvidé de anotarlo a tiempo (−15 %)'}</span>
          </label>
        </form>
      </section>

      <section className="card bf-table-card">
        <div className="bf-table" role="table" aria-label="Gastos de hoy">
          <div className="bf-tr head" role="row">
            <span role="columnheader">N°</span>
            <span role="columnheader">Descripción</span>
            <span role="columnheader">Costo</span>
            <span role="columnheader">Hora</span>
          </div>
          {list.length === 0 && <p className="muted bf-empty">Todavía no anotaste gastos hoy.</p>}
          {list.map((e, i) => {
            const a = accountOf(state, e.accountId);
            return (
              <button key={e.id} type="button" className={`bf-tr ${e.forgot ? 'forgot' : ''}`} role="row" onClick={() => setEdit(e)}>
                <span role="cell">{i + 1}</span>
                <span role="cell" className="bf-desc">
                  {e.desc}
                  <small>
                    {a?.name ?? '—'}
                    {e.forgot ? ' · olvidado' : ''}
                  </small>
                </span>
                <span role="cell">
                  <Money n={e.amount} c={a?.currency} />
                </span>
                <span role="cell">{e.time}</span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="btn-row">
        <button type="button" className="btn" onClick={() => setIncome(true)}>
          <Icon name="download" size={18} /> Entró plata
        </button>
      </div>

      <section className="card bf-close">
        {st.kind === 'closed' ? (
          <p>
            <b>Día cerrado · {st.pct} %</b>
            <br />
            <span className="muted">
              {st.late ? 'Lo cerraste de madrugada (75 %)' : 'A tiempo (100 %)'}
              {st.forgot ? ` · ${st.forgot} olvidado${st.forgot === 1 ? '' : 's'} (−${st.forgot * 15} %)` : ''}.
            </span>
          </p>
        ) : (
          <>
            <p className="muted">Revisa que esté todo y cierra tu noche. Antes de medianoche vale 100 %; de 00:00 a 03:59, 75 %.</p>
            <button type="button" className="btn primary bf-close-btn" disabled={!canClose(state, today, now)} onClick={() => setAskClose(true)}>
              <Icon name="check" /> Cerrar mi día
            </button>
          </>
        )}
      </section>

      <ConfirmDialog
        open={askClose}
        onClose={() => setAskClose(false)}
        title="¿Cerrar tu día?"
        body={`Hoy anotaste ${list.length} ${list.length === 1 ? 'gasto' : 'gastos'} (${money(spent)}). Si después te acuerdas de otro, igual lo puedes anotar: cuenta como olvidado.`}
        confirmLabel="Cerrar mi día"
        onConfirm={close}
      />

      <Sheet open={Boolean(edit)} title="Editar gasto" onClose={() => setEdit(null)}>
        {edit && <EditExpense state={state} e={edit} onDone={() => setEdit(null)} />}
      </Sheet>
      <Sheet open={income} title="Entró plata" onClose={() => setIncome(false)}>
        <IncomeForm state={state} today={today} onDone={() => setIncome(false)} />
      </Sheet>
    </main>
  );
}

function EditExpense({ state, e, onDone }: { state: AppState; e: Expense; onDone: () => void }) {
  const [desc, setDesc] = useState(e.desc);
  const [amount, setAmount] = useState(String(e.amount));
  const [acc, setAcc] = useState(e.accountId);
  const [time, setTime] = useState(e.time);
  const n = parseAmount(amount);
  return (
    <form
      className="stack"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (!n) return;
        actions.updateExpense(e.id, { desc: desc.trim() || e.desc, amount: n, accountId: acc, time });
        onDone();
      }}
    >
      <label className="lbl-field">
        <span>Descripción</span>
        <input className="field" value={desc} onChange={(ev) => setDesc(ev.target.value)} />
      </label>
      <AmountField value={amount} onChange={setAmount} label="Costo" />
      <AccountSelect state={state} value={acc} onChange={setAcc} />
      <label className="lbl-field">
        <span>Hora</span>
        <input className="field" type="time" value={time} onChange={(ev) => setTime(ev.target.value || e.time)} />
      </label>
      <button type="submit" className="btn primary" disabled={!n}>
        Guardar
      </button>
      <button
        type="button"
        className="btn danger"
        onClick={() => {
          actions.deleteExpense(e.id);
          toast('Gasto borrado. La plata volvió a su cuenta.', 'neutral');
          onDone();
        }}
      >
        <Icon name="trash" size={18} /> Borrar este gasto
      </button>
    </form>
  );
}

function IncomeForm({ state, today, onDone }: { state: AppState; today: ISODate; onDone: () => void }) {
  const qz = state.settings.quincena;
  const [isQ, setIsQ] = useState(true);
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState(qz.amount ? String(qz.amount) : '');
  const [acc, setAcc] = useState(state.accounts.find((a) => a.kind === 'banco')?.id ?? state.accounts[0]?.id ?? '');
  const n = parseAmount(amount);
  const saving = isQ ? Math.min(n ?? 0, qz.saving) : 0;
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (!n) return;
        actions.addIncome(today, { desc, amount: n, accountId: acc, quincena: isQ });
        toast(isQ ? `Quincena registrada a las ${clockOf()}. ${saving ? `${money(saving)} al ahorro.` : ''}` : 'Ingreso anotado.', 'success');
        onDone();
      }}
    >
      <div className="segmented" role="radiogroup" aria-label="Tipo de ingreso">
        <button type="button" role="radio" aria-checked={isQ} onClick={() => setIsQ(true)}>
          Mi quincena
        </button>
        <button type="button" role="radio" aria-checked={!isQ} onClick={() => setIsQ(false)}>
          Otro ingreso
        </button>
      </div>
      {!isQ && (
        <label className="lbl-field">
          <span>De qué</span>
          <input className="field" placeholder="Me pagó…, vendí…" value={desc} onChange={(e) => setDesc(e.target.value)} />
        </label>
      )}
      <AmountField value={amount} onChange={setAmount} label="Monto (Bs)" />
      <AccountSelect state={state} value={acc} onChange={setAcc} label="A qué cuenta entró" />
      {isQ && saving > 0 && <p className="fine">Se apartan {money(saving)} a tu ahorro. Tu límite queda en {money((qz.amount - qz.saving) / qz.days)} por día.</p>}
      <button type="submit" className="btn primary" disabled={!n}>
        Registrar
      </button>
    </form>
  );
}
