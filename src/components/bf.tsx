import { useState } from 'react';
import { CURRENCY_SIGN } from '../lib/config';
import { money, parseAmount } from '../lib/engine';
import type { Account, AppState, Currency } from '../lib/types';

/** Monto con su moneda. */
export function Money({ n, c = 'BOB', className }: { n: number; c?: Currency; className?: string }) {
  return <span className={`bf-money ${n < 0 ? 'neg' : ''} ${className ?? ''}`}>{money(n, c)}</span>;
}

export function accountLabel(a: Account): string {
  return `${a.name} (${CURRENCY_SIGN[a.currency]})`;
}

export function AccountSelect({ state, value, onChange, label = 'De qué cuenta', allowNone, noneLabel }: { state: AppState; value: string; onChange: (id: string) => void; label?: string; allowNone?: boolean; noneLabel?: string }) {
  return (
    <label className="lbl-field">
      <span>{label}</span>
      <select className="field" value={value} onChange={(e) => onChange(e.target.value)}>
        {allowNone && <option value="">{noneLabel ?? 'No pasó por mis cuentas'}</option>}
        {state.accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {accountLabel(a)} · {money(a.balance, a.currency)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Campo de monto con teclado numérico. */
export function AmountField({ value, onChange, label = 'Monto', placeholder = '0', autoFocus }: { value: string; onChange: (v: string) => void; label?: string; placeholder?: string; autoFocus?: boolean }) {
  return (
    <label className="lbl-field">
      <span>{label}</span>
      <input className="field" inputMode="decimal" enterKeyHint="done" value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** Formulario de un pago o cobro: monto + cuenta. */
export function PayForm({
  state,
  initial,
  currency,
  accountLabelText,
  allowNone,
  noneLabel,
  confirm,
  onDone,
}: {
  state: AppState;
  initial: number;
  currency: Currency;
  accountLabelText: string;
  allowNone?: boolean;
  noneLabel?: string;
  confirm: string;
  onDone: (amount: number, accountId: string | undefined) => void;
}) {
  const [amount, setAmount] = useState(initial ? String(initial) : '');
  const [acc, setAcc] = useState(allowNone ? '' : state.accounts[0]?.id ?? '');
  const n = parseAmount(amount);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (n) onDone(n, acc || undefined);
      }}
    >
      <AmountField value={amount} onChange={setAmount} label={`Monto (${CURRENCY_SIGN[currency]})`} autoFocus />
      <AccountSelect state={state} value={acc} onChange={setAcc} label={accountLabelText} allowNone={allowNone} noneLabel={noneLabel} />
      <button type="submit" className="btn primary" disabled={!n}>
        {confirm}
      </button>
    </form>
  );
}
