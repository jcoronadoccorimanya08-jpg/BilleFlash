import { useState } from 'react';
import { celebrate } from '../components/Confetti';
import { AccountSelect, AmountField, Money } from '../components/bf';
import { Icon } from '../components/Icon';
import { PiggyCard } from '../components/Piggy';
import { ConfirmDialog, ScreenHeader, Sheet } from '../components/ui';
import { CLOSE_PHRASES, CURRENCY_SIGN } from '../lib/config';
import { clockOf, diffDays, formatLong, localDateOf, type ISODate } from '../lib/dates';
import { accountOf, alerts, antojosLeft, mainOf, canClose, CATEGORIES, categoryInfo, categoryOf, dayStatus, favorites, guessCategory, money, parseAmount, quincenaStatus, spentOn, streak } from '../lib/engine';
import { fixedOn, KIND_ICON } from '../lib/movements';
import { haptic, toast } from '../lib/feedback';
import { actions } from '../lib/store';
import type { AppState, Category, Expense } from '../lib/types';

const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)]!;

export function TodayScreen({ state, today, now, onBackup }: { state: AppState; today: ISODate; now: Date; onBackup: () => void }) {
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
  const fixed = fixedOn(state, today);
  const q = quincenaStatus(state, today);
  const within = spent <= q.limit + 0.001;
  const usePct = q.limit > 0 ? Math.min(100, (spent / q.limit) * 100) : 0;
  const run = streak(state, now);
  const urgent = alerts(state, today);
  const n = parseAmount(amount);
  const favs = favorites(state, today);
  const anto = antojosLeft(state, today);
  const lastBackup = s.lastBackupAt ? localDateOf(s.lastBackupAt) : null;
  // Recordatorio de respaldo: cada 7 días (o si nunca hiciste uno y ya llevas 2 días usando la app).
  const needBackup = lastBackup ? diffDays(lastBackup, today) >= 7 : diffDays(s.startDate, today) >= 2;

  const quick = (f: { desc: string; amount: number; accountId: string }) => {
    actions.addExpense(today, { desc: f.desc, amount: f.amount, accountId: f.accountId });
    haptic();
    toast(`${f.desc} ${money(f.amount, accountOf(state, f.accountId)?.currency)} anotado${closed ? ' (olvidado: −15 %)' : ''}.`, 'success');
  };

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

      {needBackup && (
        <div className="bf-alert bf-backup" role="note">
          <Icon name="shield" size={16} />
          <span>{lastBackup ? `Tu último respaldo fue hace ${diffDays(lastBackup, today)} días.` : 'Todavía no hiciste ningún respaldo.'} Si pierdes el teléfono, pierdes tus datos.</span>
          <button type="button" className="btn sm" onClick={onBackup}>
            Respaldar
          </button>
        </div>
      )}

      {s.coachNote && (
        <div className="bf-alert bf-note" role="note">
          <span>💬 Tu entrenador: {s.coachNote.text}</span>
          <button type="button" className="btn sm" onClick={() => actions.setCoachNote(null)}>
            Listo
          </button>
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
          {within && q.limit > 0 && <b className="bf-anto"> Para antojos: {money(anto.left)}{anto.reserve > 0 ? ` (guardando ${money(anto.reserve)} para comer)` : ''}.</b>}
          {s.incomeMode === 'libre' ? ` Tienes ${money(q.available)} fuera de tu alcancía.` : q.q ? ` Disponible en la quincena: ${money(q.available)}${q.nextIn !== null ? ` · próxima ${q.nextIn > 0 ? `en ${q.nextIn} ${q.nextIn === 1 ? 'día' : 'días'}` : q.nextIn === 0 ? 'hoy' : `atrasada ${-q.nextIn} ${q.nextIn === -1 ? 'día' : 'días'}`}` : ''}.` : ' Registra tu quincena con «Entró plata».'}
        </p>
      </section>

      <PiggyCard state={state} today={today} />

      <section className="card">
        <h2 className="card-title">Anotar un gasto</h2>
        {favs.length > 0 && (
          <div className="bf-favs" role="group" aria-label="Tus gastos de siempre">
            {favs.map((f) => (
              <button key={`${f.desc}-${f.amount}`} type="button" className="chip bf-fav" onClick={() => quick(f)}>
                + {f.desc} {money(f.amount, accountOf(state, f.accountId)?.currency)}
              </button>
            ))}
          </div>
        )}
        <form
          className="bf-add"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input className="field" placeholder="Descripción (almuerzo, pasaje…)" value={desc} onChange={(e) => setDesc(e.target.value)} enterKeyHint="next" aria-label="Descripción" />
          <div className="bf-add-row">
            <input className="field" inputMode="decimal" placeholder={`${CURRENCY_SIGN[mainOf(state)]} 0`} value={amount} onChange={(e) => setAmount(e.target.value)} enterKeyHint="done" aria-label="Costo" />
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
          {list.length === 0 && !fixed.length && <p className="muted bf-empty">Todavía no anotaste gastos hoy.</p>}
          {list.map((e, i) => {
            const a = accountOf(state, e.accountId);
            return (
              <button key={e.id} type="button" className={`bf-tr ${e.forgot ? 'forgot' : ''}`} role="row" onClick={() => setEdit(e)}>
                <span role="cell">{i + 1}</span>
                <span role="cell" className="bf-desc">
                  {e.desc}
                  <small>
                    <i className="bf-cat-dot" style={{ background: `var(${categoryInfo(categoryOf(e)).color})` }} aria-hidden="true" />
                    {categoryInfo(categoryOf(e)).label} · {a?.name ?? '—'}
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
          {fixed.map((m) => (
            <div key={m.key} className="bf-tr fixed" role="row">
              <span role="cell" aria-label="Pago fijo">
                {KIND_ICON[m.kind]}
              </span>
              <span role="cell" className="bf-desc">
                {m.title}
                <small>{m.detail}</small>
              </span>
              <span role="cell">
                <Money n={m.amount} c={m.currency} />
              </span>
              <span role="cell">{m.time}</span>
            </div>
          ))}
        </div>
        {fixed.length > 0 && <p className="fine bf-fixed-note">📌 Los pagos fijos y de deudas se ven aquí para que todo cuadre, pero no cuentan para tu límite del día. Para deshacer uno: Cuentas → 📜 Movimientos.</p>}
      </section>

      <div className="btn-row">
        <button type="button" className="btn" onClick={() => setIncome(true)}>
          <Icon name="download" size={18} /> {s.incomeMode === 'libre' ? 'Me dieron plata' : 'Entró plata'}
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
      <Sheet open={income} title={s.incomeMode === 'libre' ? 'Me dieron plata' : 'Entró plata'} onClose={() => setIncome(false)}>
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
  const [cat, setCat] = useState<Category>(categoryOf(e));
  const n = parseAmount(amount);
  return (
    <form
      className="stack"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (!n) return;
        actions.updateExpense(e.id, { desc: desc.trim() || e.desc, amount: n, accountId: acc, time, category: cat === guessCategory(desc) && !e.category ? undefined : cat });
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
        <span>Categoría</span>
        <select className="field" value={cat} onChange={(ev) => setCat(ev.target.value as Category)}>
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
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
  const libre = state.settings.incomeMode === 'libre';
  const pct = state.settings.savingPct ?? 0;
  const [isQ, setIsQ] = useState(!libre);
  const [keep, setKeep] = useState(true);
  const sign = CURRENCY_SIGN[mainOf(state)];
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState(!libre && qz.amount ? String(qz.amount) : '');
  const [acc, setAcc] = useState(state.accounts.find((a) => a.kind === 'banco')?.id ?? state.accounts[0]?.id ?? '');
  const n = parseAmount(amount);
  const saving = isQ ? Math.min(n ?? 0, qz.saving) : libre && keep ? Math.round((n ?? 0) * pct) / 100 : 0;
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (!n) return;
        actions.addIncome(today, { desc: desc || (libre ? 'Me dieron' : ''), amount: n, accountId: acc, quincena: isQ, save: keep });
        toast(isQ ? `Quincena registrada a las ${clockOf()}. ${saving ? `${money(saving)} al ahorro.` : ''}` : saving ? `Anotado. 🐷 ${money(saving)} a tu alcancía.` : 'Ingreso anotado.', 'success');
        onDone();
      }}
    >
      {!libre && (
      <div className="segmented" role="radiogroup" aria-label="Tipo de ingreso">
        <button type="button" role="radio" aria-checked={isQ} onClick={() => setIsQ(true)}>
          Mi quincena
        </button>
        <button type="button" role="radio" aria-checked={!isQ} onClick={() => setIsQ(false)}>
          Otro ingreso
        </button>
      </div>
      )}
      {!isQ && (
        <label className="lbl-field">
          <span>De qué</span>
          <input className="field" placeholder={libre ? 'Propina, pasaje, cumple…' : 'Me pagó…, vendí…'} value={desc} onChange={(e) => setDesc(e.target.value)} />
        </label>
      )}
      <AmountField value={amount} onChange={setAmount} label={`Monto (${sign})`} />
      <AccountSelect state={state} value={acc} onChange={setAcc} label="A qué cuenta entró" />
      {libre && pct > 0 && (
        <label className="bf-check">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
          <span>Apartar {pct} % a mi alcancía{n ? ` (${money(saving)})` : ''}</span>
        </label>
      )}
      {isQ && saving > 0 && <p className="fine">Se apartan {money(saving)} a tu ahorro. Tu límite queda en {money((qz.amount - qz.saving) / qz.days)} por día.</p>}
      <button type="submit" className="btn primary" disabled={!n}>
        Registrar
      </button>
    </form>
  );
}
