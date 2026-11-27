import { useMemo, useState } from 'react';
import { ConfirmDialog } from './ui';
import { formatShort, weekdayShort, type ISODate } from '../lib/dates';
import { money } from '../lib/engine';
import { toast } from '../lib/feedback';
import { amountIn, KIND_ICON, movements, type Movement } from '../lib/movements';
import { actions } from '../lib/store';
import type { AppState } from '../lib/types';

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const s = new Date(Date.UTC(y!, m! - 1, 15)).toLocaleString('es-BO', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function undo(m: Movement) {
  const u = m.undo;
  if (u.type === 'expense') actions.deleteExpense(u.id);
  else if (u.type === 'income') actions.deleteIncome(u.id);
  else if (u.type === 'transfer') actions.deleteTransfer(u.id);
  else if (u.type === 'bill') actions.undoBillPay(u.billId, u.index);
  else if (u.type === 'debt') actions.undoDebtPay(u.debtId, u.index);
  else actions.undoAdjust(u.id);
}

function undoText(m: Movement, state: AppState): string {
  const where = m.lines.length ? 'La plata vuelve a tu cuenta como estaba antes' : 'No cambia ninguna cuenta (no pasó por ellas)';
  if (m.kind === 'pago') return `${where}, y ${m.title.includes('meses') ? 'esos meses vuelven' : 'ese mes vuelve'} a quedar pendiente en Pagos.`;
  if (m.kind === 'ingreso') return `${where}. Si era quincena, también se quita lo que se apartó al ahorro.`;
  if (m.kind === 'mover') return 'Cada monto vuelve a la cuenta de donde salió.';
  if (m.kind === 'ajuste') return 'El saldo de esa cuenta vuelve a lo que decía antes de que lo cuadraras.';
  void state;
  return `${where}.`;
}

/** Todo lo que entró y salió, con filtro por cuenta y por mes. Cada movimiento se puede deshacer. */
export function Movements({ state, account: preset }: { state: AppState; account?: string }) {
  const all = useMemo(() => movements(state), [state]);
  const months = useMemo(() => [...new Set(all.map((m) => m.date.slice(0, 7)))], [all]);
  const [account, setAccount] = useState(preset ?? '');
  const [month, setMonth] = useState(months[0] ?? '');
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Movement | null>(null);

  const list = all.filter((m) => (!account || m.lines.some((l) => l.accountId === account)) && (!month || m.date.startsWith(month)));
  const acc = state.accounts.find((a) => a.id === account);
  const inSum = acc ? list.reduce((s, m) => s + Math.max(0, amountIn(m, acc.id)), 0) : 0;
  const outSum = acc ? list.reduce((s, m) => s + Math.min(0, amountIn(m, acc.id)), 0) : 0;
  const days: [ISODate, Movement[]][] = [];
  for (const m of list) {
    const last = days[days.length - 1];
    if (last && last[0] === m.date) last[1].push(m);
    else days.push([m.date, [m]]);
  }

  return (
    <div className="stack mv">
      <div className="mv-filters">
        <label className="lbl-field">
          <span>Cuenta</span>
          <select className="field" value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="">Todas mis cuentas</option>
            {state.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="lbl-field">
          <span>Mes</span>
          <select className="field" value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
            <option value="">Todo</option>
          </select>
        </label>
      </div>

      {acc && (
        <div className="mv-sum card">
          <span>
            Entró <b className="mv-in">{money(inSum, acc.currency)}</b>
          </span>
          <span>
            Salió <b className="mv-out">{money(-outSum, acc.currency)}</b>
          </span>
          <span>
            Hoy tiene <b>{money(acc.balance, acc.currency)}</b>
          </span>
        </div>
      )}

      {!list.length && <p className="muted">No hay movimientos con este filtro.</p>}

      {days.map(([d, items]) => (
        <section key={d} className="mv-day">
          <h3 className="mv-date">
            {weekdayShort(d)} {formatShort(d)}
          </h3>
          <div className="card list">
            {items.map((m) => {
              const shown = acc ? amountIn(m, acc.id) : m.kind === 'mover' ? 0 : m.amount;
              const isOpen = open === m.key;
              return (
                <div key={m.key} className={`mv-item ${isOpen ? 'open' : ''}`}>
                  <button type="button" className="item mv-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : m.key)}>
                    <span className="mv-ico" aria-hidden="true">
                      {KIND_ICON[m.kind]}
                    </span>
                    <span className="txt">
                      <b>{m.title}</b>
                      <span>
                        {m.detail}
                        {m.time ? ` · ${m.time}` : ''}
                      </span>
                    </span>
                    <span className={`mv-amt ${shown > 0 ? 'in' : shown < 0 ? 'out' : ''}`}>
                      {m.kind === 'mover' && !acc ? `↔ ${money(m.amount, m.currency)}` : `${shown > 0 ? '+' : shown < 0 ? '−' : ''}${money(Math.abs(shown), acc?.currency ?? m.currency)}`}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="mv-detail">
                      {m.lines.length ? (
                        <ul>
                          {m.lines.map((l, i) => {
                            const a = state.accounts.find((x) => x.id === l.accountId);
                            return (
                              <li key={i}>
                                {l.amount < 0 ? 'Salió de' : 'Entró a'} <b>{a?.name ?? 'cuenta quitada'}</b>: {money(Math.abs(l.amount), a?.currency)}
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="fine">No pasó por tus cuentas.</p>
                      )}
                      <FixAccount state={state} m={m} />
                      <button type="button" className="btn sm danger" onClick={() => setConfirm(m)}>
                        ↩️ Deshacer
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title={confirm ? `¿Deshacer «${confirm.title}»?` : ''}
        body={confirm ? undoText(confirm, state) : ''}
        confirmLabel="Deshacer"
        danger
        onConfirm={() => {
          if (!confirm) return;
          undo(confirm);
          setOpen(null);
          toast('Listo, deshecho.', 'success');
        }}
      />
    </div>
  );
}

/** «¿Entró a otra cuenta?»: corrige la cuenta de un cobro, un pago o un gasto (la plata se mueve sola). */
function FixAccount({ state, m }: { state: AppState; m: Movement }) {
  const u = m.undo;
  if (u.type !== 'debt' && u.type !== 'bill' && u.type !== 'expense') return null;
  const current = m.lines[0]?.accountId ?? '';
  const label = m.kind === 'cobro' ? '¿Entró a otra cuenta?' : '¿Salió de otra cuenta?';
  return (
    <label className="lbl-field fix-acc">
      <span>{label}</span>
      <select
        className="field"
        value={current}
        onChange={(e) => {
          const to = e.target.value || undefined;
          if (u.type === 'debt') actions.moveDebtPay(u.debtId, u.index, to);
          else if (u.type === 'bill') actions.moveBillPay(u.billId, u.index, to);
          else if (to) actions.updateExpense(u.id, { accountId: to });
          const name = state.accounts.find((a) => a.id === to)?.name;
          toast(name ? `Listo: ahora está en ${name}.` : 'Listo: no pasó por tus cuentas.', 'success');
        }}
      >
        {state.accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
        {u.type !== 'expense' && <option value="">No pasó por mis cuentas</option>}
      </select>
    </label>
  );
}
