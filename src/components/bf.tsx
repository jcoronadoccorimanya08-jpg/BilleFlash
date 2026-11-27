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

const KIND_ICON: Record<Account['kind'], string> = { banco: '🏦', efectivo: '💵', billetera: '📱', ahorro: '🐷' };

/**
 * Elegir la cuenta con botones grandes (no un menú escondido): «🏦 BNB (QR)», «💵 Efectivo»… Así no se te
 * pasa que el cobro entró al banco.
 */
export function AccountPicker({ state, value, onChange, label, allowNone, noneLabel }: { state: AppState; value: string; onChange: (id: string) => void; label: string; allowNone?: boolean; noneLabel?: string }) {
  return (
    <div className="lbl-field">
      <span>{label}</span>
      <div className="acc-pick" role="radiogroup" aria-label={label}>
        {state.accounts.map((a) => (
          <button key={a.id} type="button" role="radio" aria-checked={value === a.id} className="acc-chip" onClick={() => onChange(a.id)}>
            <span aria-hidden="true">{KIND_ICON[a.kind]}</span>
            <span className="acc-chip-txt">
              <b>{a.name}</b>
              <small>
                {a.kind === 'banco' || a.kind === 'billetera' ? 'QR / transferencia · ' : ''}
                {money(a.balance, a.currency)}
              </small>
            </span>
          </button>
        ))}
        {allowNone && (
          <button type="button" role="radio" aria-checked={value === ''} className="acc-chip none" onClick={() => onChange('')}>
            <span aria-hidden="true">🚫</span>
            <span className="acc-chip-txt">
              <b>{noneLabel ?? 'No pasó por mis cuentas'}</b>
            </span>
          </button>
        )}
      </div>
    </div>
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
  defaultNone,
  defaultAccount,
  confirm,
  onDone,
}: {
  state: AppState;
  initial: number;
  currency: Currency;
  accountLabelText: string;
  allowNone?: boolean;
  noneLabel?: string;
  /** Empieza en «no pasó por mis cuentas» (solo para pagos del depa). */
  defaultNone?: boolean;
  /** La cuenta que viene elegida (por ejemplo, la que usaste la última vez). */
  defaultAccount?: string;
  confirm: string;
  onDone: (amount: number, accountId: string | undefined) => void;
}) {
  const [amount, setAmount] = useState(initial ? String(initial) : '');
  const [acc, setAcc] = useState(defaultNone ? '' : state.accounts.some((a) => a.id === defaultAccount) ? defaultAccount! : ((state.accounts.find((a) => a.kind === 'efectivo') ?? state.accounts[0])?.id ?? ''));
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
      <AccountPicker state={state} value={acc} onChange={setAcc} label={accountLabelText} allowNone={allowNone} noneLabel={noneLabel} />
      <button type="submit" className="btn primary" disabled={!n}>
        {confirm}
      </button>
    </form>
  );
}
