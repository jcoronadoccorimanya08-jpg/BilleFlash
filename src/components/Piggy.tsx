import { useState } from 'react';
import { AccountSelect, AmountField } from './bf';
import { Sheet } from './ui';
import { CURRENCY_SIGN } from '../lib/config';
import { formatShort, type ISODate } from '../lib/dates';
import { mainOf, money, parseAmount, piggyMoves, piggyStats } from '../lib/engine';
import { haptic, toast } from '../lib/feedback';
import { actions } from '../lib/store';
import type { AppState } from '../lib/types';

/** «🐷 Mi alcancía»: cada moneda que metes, con su fecha y hora, y cuánto llevas en la semana y el mes. */
export function PiggyCard({ state, today }: { state: AppState; today: ISODate }) {
  const [other, setOther] = useState(false);
  const [list, setList] = useState(false);
  const sid = state.settings.savingAccountId;
  const from = state.accounts.find((a) => a.kind === 'efectivo' && a.id !== sid) ?? state.accounts.find((a) => a.id !== sid);
  if (!sid || !from) return null;
  const p = piggyStats(state, today);
  const sign = CURRENCY_SIGN[mainOf(state)];
  const put = (n: number, acc = from.id) => {
    actions.toPiggy(today, n, acc);
    haptic([15, 30, 15]);
    toast(`🐷 ${money(n)} a tu alcancía. ¡Bien ahí!`, 'reward');
  };
  return (
    <section className="card bf-piggy">
      <div className="bf-piggy-top">
        <div>
          <span className="muted">🐷 Mi alcancía</span>
          <b>{money(p.total)}</b>
        </div>
        <div className="bf-right">
          <span className="muted">Esta semana · este mes</span>
          <span className="bf-piggy-sums">
            +{money(p.week)} · +{money(p.month)}
          </span>
          {p.streak > 0 && <span className="bf-piggy-streak">{p.streak === 1 ? 'Hoy ahorraste 💪' : `${p.streak} días seguidos ahorrando`}</span>}
        </div>
      </div>
      <div className="bf-favs" role="group" aria-label="Meter a la alcancía">
        {[1, 2, 5].map((n) => (
          <button key={n} type="button" className="chip bf-fav" onClick={() => put(n)}>
            + {sign} {n}
          </button>
        ))}
        <button type="button" className="chip bf-fav" onClick={() => setOther(true)}>
          Otro monto
        </button>
        <button type="button" className="chip bf-fav ghost" onClick={() => setList(true)}>
          Ver detalle
        </button>
      </div>
      <Sheet open={other} title="Meter a la alcancía" onClose={() => setOther(false)}>
        <OtherAmount
          state={state}
          from={from.id}
          onDone={(n, acc) => {
            put(n, acc);
            setOther(false);
          }}
        />
      </Sheet>
      <Sheet open={list} title="Tu alcancía, moneda por moneda" onClose={() => setList(false)}>
        <PiggyList state={state} />
      </Sheet>
    </section>
  );
}

function OtherAmount({ state, from, onDone }: { state: AppState; from: string; onDone: (n: number, acc: string) => void }) {
  const [v, setV] = useState('');
  const [acc, setAcc] = useState(from);
  const n = parseAmount(v);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (n) onDone(n, acc);
      }}
    >
      <AmountField value={v} onChange={setV} label={`Monto (${CURRENCY_SIGN[mainOf(state)]})`} autoFocus />
      <AccountSelect state={state} value={acc} onChange={setAcc} label="De dónde sale" />
      <button type="submit" className="btn primary" disabled={!n}>
        Meter
      </button>
    </form>
  );
}

export function PiggyList({ state }: { state: AppState }) {
  const moves = piggyMoves(state);
  if (!moves.length) return <p className="muted">Todavía no metiste nada. ¡Empieza con una moneda!</p>;
  return (
    <div className="bf-hist-wrap">
      <table className="bf-hist">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Hora</th>
            <th>Qué</th>
            <th>Monto</th>
          </tr>
        </thead>
        <tbody>
          {moves.map((m, i) => (
            <tr key={i}>
              <td>{formatShort(m.date)}</td>
              <td>{m.time}</td>
              <td>{m.what}</td>
              <td className={m.amount >= 0 ? 'ok' : 'over'}>
                {m.amount >= 0 ? '+' : '−'}
                {money(Math.abs(m.amount))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
