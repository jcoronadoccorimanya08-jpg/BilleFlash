import { useState } from 'react';
import { AmountField, PayForm } from '../components/bf';
import { Icon } from '../components/Icon';
import { ConfirmDialog, ScreenHeader, SectionTitle, Sheet } from '../components/ui';
import { CURRENCY_SIGN } from '../lib/config';
import { formatShort, type ISODate } from '../lib/dates';
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
                <button type="button" className={`btn sm ${st.kind === 'late' || st.kind === 'today' ? 'primary' : ''}`} onClick={() => setPay(b)}>
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
      <button type="button" className="btn ghost" onClick={() => setEdit('new')}>
        <Icon name="plus" size={18} /> Nuevo pago
      </button>

      <Sheet open={Boolean(pay)} title={pay ? `Pagar ${pay.name}` : ''} onClose={() => setPay(null)}>
        {pay && (
          <>
            <p className="fine">Se paga el vencimiento del {formatShort(pay.nextDue!)}. Si debes varios meses, págalos uno por uno.</p>
            <PayForm
              state={state}
              initial={pay.amount}
              currency={pay.currency}
              accountLabelText="De dónde salió"
              allowNone
              noneLabel={pay.source === 'depa' ? 'Plata del depa (aparte)' : 'No pasó por mis cuentas'}
              defaultNone={pay.source === 'depa'}
              confirm="Pagado"
              onDone={(amount, acc) => {
                actions.payBill(pay.id, today, amount, acc);
                toast(`${pay.name} pagado.`, 'success');
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
        {edit && <BillForm bill={edit === 'new' ? null : edit} today={today} onDone={() => setEdit(null)} />}
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

function BillForm({ bill, today, onDone }: { bill: Bill | null; today: ISODate; onDone: () => void }) {
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
      {bill && (
        <button type="button" className="btn danger" onClick={() => setDel(true)}>
          <Icon name="trash" size={18} /> Quitar este pago
        </button>
      )}
      <ConfirmDialog
        open={del}
        onClose={() => setDel(false)}
        title="¿Quitar este pago?"
        body="Ya no te avisará. Lo que pagaste antes queda en tus cuentas como está."
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
