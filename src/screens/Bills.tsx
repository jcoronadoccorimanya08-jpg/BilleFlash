import { useState } from 'react';
import { AmountField, PayForm } from '../components/bf';
import { Icon } from '../components/Icon';
import { ConfirmDialog, ScreenHeader, SectionTitle, Sheet } from '../components/ui';
import { CURRENCY_SIGN } from '../lib/config';
import { addMonths, formatShort, localDateOf, type ISODate } from '../lib/dates';
import { billStatus, money, parseAmount, type BillStatus } from '../lib/engine';
import { toast } from '../lib/feedback';
import { actions } from '../lib/store';
import type { AppState, Bill, Currency } from '../lib/types';

function statusText(b: Bill, st: BillStatus): string {
  if (st.kind === 'none') return 'Sin recibo pendiente';
  if (st.kind === 'late') {
    const late = st.dues.length;
    return b.kind === 'mensual' ? `Atrasado: ${late} ${late === 1 ? 'mes' : 'meses'} · debes ${money(st.owed, b.currency)}` : `Atrasado desde el ${formatShort(b.nextDue!)}`;
  }
  if (st.kind === 'today') return 'Vence hoy';
  if (st.inDays === null) return '';
  return `Vence el ${formatShort(b.nextDue!)} (en ${st.inDays} ${st.inDays === 1 ? 'día' : 'días'})`;
}

export function BillsScreen({ state, today }: { state: AppState; today: ISODate }) {
  const [pay, setPay] = useState<Bill | null>(null);
  const [edit, setEdit] = useState<Bill | 'new' | null>(null);
  const [receipt, setReceipt] = useState<Bill | null>(null);
  const [months, setMonths] = useState(1);
  const order = { late: 0, today: 1, soon: 2, ok: 3, none: 4 } as const;
  const rows = state.bills.map((b) => ({ b, st: billStatus(b, today) })).sort((x, y) => order[x.st.kind] - order[y.st.kind]);
  const section = (source: Bill['source'], title: string) => {
    const list = rows.filter((r) => r.b.source === source);
    if (!list.length) return null;
    return (
      <>
        <SectionTitle>{title}</SectionTitle>
        <div className="card list">
          {list.map(({ b, st }) => (
            <div key={b.id} className={`item bf-bill ${st.kind}`}>
              <button type="button" className="txt bf-bill-txt" onClick={() => setEdit(b)}>
                <b>
                  {b.name} · {money(b.amount, b.currency)}
                </b>
                <span>{statusText(b, st)}</span>
              </button>
              {b.nextDue ? (
                <button type="button" className={`btn sm ${st.kind === 'late' || st.kind === 'today' ? 'primary' : ''}`} onClick={() => {
                    setMonths(1);
                    setPay(b);
                  }}
                >
                  Pagar
                </button>
              ) : (
                <button type="button" className="btn sm" onClick={() => setReceipt(b)}>
                  Llegó
                </button>
              )}
            </div>
          ))}
        </div>
      </>
    );
  };

  return (
    <main className="screen">
      <ScreenHeader eyebrow="Que nada se te pase" title="Pagos" />
      {section('mio', 'De mi plata')}
      {section('depa', 'Del depa (plata aparte)')}
      {!state.bills.length && <p className="muted">Agrega tus pagos: depa, luz, internet, Claude, gym…</p>}
      {(state.removedBills ?? []).length > 0 && (
        <>
          <SectionTitle>Pagos quitados</SectionTitle>
          <div className="card list">
            {[...(state.removedBills ?? [])].reverse().map((b) => (
              <div key={b.id} className="item">
                <span className="txt">
                  <b>
                    {b.name} · {money(b.amount, b.currency)}
                  </b>
                  <span>Lo quitaste el {formatShort(localDateOf(b.removedAt))}. Vuelve con todo su historial.</span>
                </span>
                <button
                  type="button"
                  className="btn sm primary"
                  onClick={() => {
                    actions.restoreBill(b.id);
                    toast(`${b.name} volvió a tus pagos.`, 'success');
                  }}
                >
                  Recuperar
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      <button type="button" className="btn ghost" onClick={() => setEdit('new')}>
        <Icon name="plus" size={18} /> Nuevo pago
      </button>

      <Sheet open={Boolean(pay)} title={pay ? `Pagar ${pay.name}` : ''} onClose={() => setPay(null)}>
        {pay && (
          <>
            {pay.kind === 'mensual' && (
              <div className="stack">
                <span className="fine">¿Cuántos meses cubre este pago?</span>
                <div className="segmented" role="radiogroup" aria-label="Meses que cubre">
                  {[1, 2, 3, 4].map((n) => (
                    <button key={n} type="button" role="radio" aria-checked={months === n} onClick={() => setMonths(n)}>
                      {n} {n === 1 ? 'mes' : 'meses'}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <p className="fine">
              {pay.kind === 'mensual' && months > 1
                ? `Cubre ${months} meses: desde el vencimiento del ${formatShort(pay.nextDue!)} hasta el del ${formatShort(addMonths(pay.nextDue!, months - 1))}.`
                : `Se paga el vencimiento del ${formatShort(pay.nextDue!)}.`}{' '}
              Queda en tus movimientos (Cuentas → 📜) y en la lista de hoy.
            </p>
            <PayForm
              key={months}
              state={state}
              initial={Math.round(pay.amount * (pay.kind === 'mensual' ? months : 1) * 100) / 100}
              currency={pay.currency}
              accountLabelText="De dónde salió"
              allowNone
              noneLabel={pay.source === 'depa' ? 'Plata del depa (aparte)' : 'No pasó por mis cuentas'}
              defaultNone={pay.source === 'depa'}
              confirm="Pagado"
              onDone={(amount, acc) => {
                actions.payBill(pay.id, today, amount, acc, pay.kind === 'mensual' ? months : 1);
                toast(`${pay.name} pagado${pay.kind === 'mensual' && months > 1 ? ` (${months} meses)` : ''}.`, 'success');
                setPay(null);
              }}
            />
          </>
        )}
      </Sheet>
      <Sheet open={Boolean(receipt)} title={receipt ? `Llegó el recibo de ${receipt.name}` : ''} onClose={() => setReceipt(null)}>
        {receipt && <ReceiptForm b={receipt} today={today} onDone={() => setReceipt(null)} />}
      </Sheet>
      <Sheet open={Boolean(edit)} title={edit === 'new' ? 'Nuevo pago' : edit ? `Editar ${edit.name}` : ''} onClose={() => setEdit(null)}>
        {edit && <BillForm bill={edit === 'new' ? null : (state.bills.find((b) => b.id === edit.id) ?? null)} state={state} today={today} onDone={() => setEdit(null)} />}
      </Sheet>
    </main>
  );
}

function ReceiptForm({ b, today, onDone }: { b: Bill; today: ISODate; onDone: () => void }) {
  const [amount, setAmount] = useState(b.amount ? String(b.amount) : '');
  const [due, setDue] = useState(today);
  const n = parseAmount(amount);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (!n) return;
        actions.updateBill(b.id, { amount: n, nextDue: due });
        onDone();
      }}
    >
      <AmountField value={amount} onChange={setAmount} label={`Monto del recibo (${CURRENCY_SIGN[b.currency]})`} autoFocus />
      <label className="lbl-field">
        <span>Vence</span>
        <input className="field" type="date" value={due} onChange={(e) => setDue(e.target.value || due)} />
      </label>
      <button type="submit" className="btn primary" disabled={!n}>
        Guardar
      </button>
    </form>
  );
}

function BillForm({ bill, state, today, onDone }: { bill: Bill | null; state: AppState; today: ISODate; onDone: () => void }) {
  const [undoIdx, setUndoIdx] = useState<number | null>(null);
  const [name, setName] = useState(bill?.name ?? '');
  const [amount, setAmount] = useState(bill ? String(bill.amount) : '');
  const [currency, setCurrency] = useState<Currency>(bill?.currency ?? 'BOB');
  const [kind, setKind] = useState<Bill['kind']>(bill?.kind ?? 'mensual');
  const [source, setSource] = useState<Bill['source']>(bill?.source ?? 'mio');
  const [due, setDue] = useState(bill?.nextDue ?? today);
  const [del, setDel] = useState(false);
  const n = parseAmount(amount) ?? (amount.trim() === '0' ? 0 : null);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || n === null) return;
        const data = { name: name.trim(), amount: n, currency, kind, source, nextDue: kind === 'mensual' || bill?.nextDue ? due : undefined };
        if (bill) actions.updateBill(bill.id, data);
        else actions.addBill(data);
        onDone();
      }}
    >
      <label className="lbl-field">
        <span>Nombre</span>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Internet, luz, gym…" />
      </label>
      <AmountField value={amount} onChange={setAmount} label={`Monto (${CURRENCY_SIGN[currency]})`} />
      <div className="segmented" role="radiogroup" aria-label="Moneda">
        {(['BOB', 'PEN'] as Currency[]).map((c) => (
          <button key={c} type="button" role="radio" aria-checked={currency === c} onClick={() => setCurrency(c)}>
            {c === 'BOB' ? 'Bolivianos' : 'Soles'}
          </button>
        ))}
      </div>
      <div className="segmented" role="radiogroup" aria-label="Cada cuánto">
        <button type="button" role="radio" aria-checked={kind === 'mensual'} onClick={() => setKind('mensual')}>
          Cada mes
        </button>
        <button type="button" role="radio" aria-checked={kind === 'recibo'} onClick={() => setKind('recibo')}>
          Cuando llega el recibo
        </button>
      </div>
      <div className="segmented" role="radiogroup" aria-label="De qué plata">
        <button type="button" role="radio" aria-checked={source === 'mio'} onClick={() => setSource('mio')}>
          De mi plata
        </button>
        <button type="button" role="radio" aria-checked={source === 'depa'} onClick={() => setSource('depa')}>
          Del depa
        </button>
      </div>
      {(kind === 'mensual' || bill?.nextDue) && (
        <label className="lbl-field">
          <span>{kind === 'mensual' ? 'Próximo vencimiento sin pagar (si debes meses, el más antiguo)' : 'Vence'}</span>
          <input className="field" type="date" value={due} onChange={(e) => setDue(e.target.value || due)} />
        </label>
      )}
      <button type="submit" className="btn primary" disabled={!name.trim() || n === null}>
        Guardar
      </button>
      {bill && bill.paid.length > 0 && (
        <section className="stack">
          <b>Pagos hechos</b>
          <div className="card list bf-paid-list">
            {bill.paid
              .map((p, i) => ({ p, i }))
              .reverse()
              .slice(0, 24)
              .map(({ p, i }) => {
                const a = state.accounts.find((x) => x.id === p.accountId);
                return (
                  <div key={i} className="item">
                    <span className="txt">
                      <b>
                        {money(p.amount, bill.currency)}
                        {(p.months ?? 1) > 1 ? ` · ${p.months} meses` : ''}
                      </b>
                      <span>
                        Pagado el {formatShort(p.date)}
                        {p.time ? ` ${p.time}` : ''} · {a ? `de ${a.name}` : bill.source === 'depa' ? 'plata del depa' : 'no pasó por tus cuentas'}
                        {bill.kind === 'mensual' ? ` · mes del ${formatShort(p.due)}` : ''}
                      </span>
                    </span>
                    <button type="button" className="btn sm" onClick={() => setUndoIdx(i)}>
                      Deshacer
                    </button>
                  </div>
                );
              })}
          </div>
        </section>
      )}
      <ConfirmDialog
        open={undoIdx !== null}
        onClose={() => setUndoIdx(null)}
        title="¿Deshacer este pago?"
        body="La plata vuelve a la cuenta de donde salió y ese mes (o esos meses) vuelven a quedar pendientes."
        confirmLabel="Deshacer"
        danger
        onConfirm={() => {
          if (bill && undoIdx !== null) actions.undoBillPay(bill.id, undoIdx);
          toast('Pago deshecho.', 'success');
          onDone();
        }}
      />
      {bill && (
        <button type="button" className="btn danger" onClick={() => setDel(true)}>
          <Icon name="trash" size={18} /> Quitar este pago
        </button>
      )}
      <ConfirmDialog
        open={del}
        onClose={() => setDel(false)}
        title="¿Quitar este pago?"
        body="Ya no te avisará. Lo que pagaste queda en tus cuentas como está. Si te equivocas, lo recuperas abajo, en «Pagos quitados»."
        confirmLabel="Quitar"
        danger
        onConfirm={() => {
          if (bill) actions.deleteBill(bill.id);
          onDone();
        }}
      />
    </form>
  );
}
