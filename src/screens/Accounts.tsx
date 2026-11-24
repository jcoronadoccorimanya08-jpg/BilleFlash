import { useState } from 'react';
import { AccountSelect, AmountField, Money } from '../components/bf';
import { GoalsSection } from '../components/Goals';
import { Icon } from '../components/Icon';
import { ScreenHeader, SectionTitle, Sheet } from '../components/ui';
import { CURRENCY_SIGN, KIND_LABEL } from '../lib/config';
import type { ISODate } from '../lib/dates';
import { accountOf, capital, dollars, money, parseAmount } from '../lib/engine';
import { toast } from '../lib/feedback';
import { actions, convert } from '../lib/store';
import type { Account, AccountKind, AppState, Currency } from '../lib/types';

export function AccountsScreen({ state, today }: { state: AppState; today: ISODate }) {
  const s = state.settings;
  const c = capital(state);
  const [rate, setRate] = useState(false);
  const [square, setSquare] = useState<Account | null>(null);
  const [add, setAdd] = useState(false);
  const [move, setMove] = useState(false);
  const groups: [string, Account[]][] = [
    ['En bolivianos', state.accounts.filter((a) => a.currency === 'BOB')],
    ['En soles', state.accounts.filter((a) => a.currency === 'PEN')],
  ];

  return (
    <main className="screen">
      <ScreenHeader eyebrow="Dónde está tu plata" title="Cuentas" />

      <section className="card bf-capital">
        <div className="bf-cap-main">
          <span className="muted">Tu capital</span>
          <b>{money(c.capital)}</b>
          <div className="bf-cap-other">
            {s.mainCurrency === 'PEN' ? <span>{money(c.capital * s.rate, 'BOB')}</span> : <span>{money(c.capital / s.rate, 'PEN')}</span>}
            <span>{s.usdRate ? dollars((s.mainCurrency === 'PEN' ? c.capital : c.capital / s.rate) / s.usdRate) : '$ —'}</span>
          </div>
        </div>
        <div className="tiles bf-tiles">
          <div className="tile">
            <b>{money(c.enMano)}</b>
            <span>En mano{c.ahorro ? ` (ahorro ${money(c.ahorro)})` : ''}</span>
          </div>
          <div className="tile">
            <b className="ok">{money(c.meDeben)}</b>
            <span>Te deben</span>
          </div>
          <div className="tile">
            <b className="over">{money(c.debo)}</b>
            <span>Debes</span>
          </div>
          <button type="button" className="tile bf-rate" onClick={() => setRate(true)}>
            <span className="bf-rate-line">
              <b>{s.rate}</b> Bs = 1 S/
            </span>
            <span className="bf-rate-line">
              <b>{s.usdRate ?? '—'}</b> S/ = 1 $
            </span>
            <span>
              <u>{s.usdRate ? 'cambiar' : 'poner el dólar'}</u>
            </span>
          </button>
        </div>
        <p className="fine">Lo que tienes + lo que te deben − lo que debes, todo en Bs con tu tipo de cambio.</p>
      </section>

      <GoalsSection state={state} today={today} />

      {groups.map(([title, list]) =>
        list.length ? (
          <section key={title}>
            <SectionTitle>{title}</SectionTitle>
            <div className="card list">
              {list.map((a) => (
                <button key={a.id} type="button" className="item bf-acc" onClick={() => setSquare(a)}>
                  <span className="txt">
                    <b>{a.name}</b>
                    <span>{KIND_LABEL[a.kind]}</span>
                  </span>
                  <Money n={a.balance} c={a.currency} />
                </button>
              ))}
            </div>
          </section>
        ) : null,
      )}

      <div className="btn-row">
        <button type="button" className="btn" onClick={() => setMove(true)}>
          <Icon name="refresh" size={18} /> Mover plata
        </button>
        <button type="button" className="btn" onClick={() => setAdd(true)}>
          <Icon name="plus" size={18} /> Nueva cuenta
        </button>
      </div>

      <Sheet open={rate} title="Tipo de cambio de hoy" onClose={() => setRate(false)}>
        <RateForm rate={s.rate} usd={s.usdRate} onDone={() => setRate(false)} />
      </Sheet>
      <Sheet open={Boolean(square)} title={square ? `Cuadrar ${square.name}` : ''} onClose={() => setSquare(null)}>
        {square && <SquareForm a={square} state={state} onDone={() => setSquare(null)} />}
      </Sheet>
      <Sheet open={add} title="Nueva cuenta" onClose={() => setAdd(false)}>
        <NewAccount onDone={() => setAdd(false)} />
      </Sheet>
      <Sheet open={move} title="Mover plata" onClose={() => setMove(false)}>
        <MoveForm state={state} today={today} onDone={() => setMove(false)} />
      </Sheet>
    </main>
  );
}

function RateForm({ rate, usd, onDone }: { rate: number; usd?: number; onDone: () => void }) {
  const [v, setV] = useState(String(rate));
  const [u, setU] = useState(usd ? String(usd) : '');
  const n = parseAmount(v);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (!n) return;
        actions.setRate(n);
        actions.setUsdRate(parseAmount(u));
        toast(`Tipo de cambio: ${n}`, 'success');
        onDone();
      }}
    >
      <AmountField value={v} onChange={setV} label="Cuántos Bs vale 1 sol" autoFocus />
      <AmountField value={u} onChange={setU} label="Cuántos soles vale 1 dólar" placeholder="Por ejemplo 3,40" />
      <p className="fine">Cambia cuando quieras. Cada vez que cierras tu día, la foto de tu capital guarda el de ese día.</p>
      <button type="submit" className="btn primary" disabled={!n}>
        Guardar
      </button>
    </form>
  );
}

function SquareForm({ a, state, onDone }: { a: Account; state: AppState; onDone: () => void }) {
  const [v, setV] = useState(String(a.balance));
  const [name, setName] = useState(a.name);
  const n = v.trim() === '0' ? 0 : parseAmount(v);
  const used = state.expenses.some((e) => e.accountId === a.id) || state.incomes.some((e) => e.accountId === a.id) || state.transfers.some((t) => t.from === a.id || t.to === a.id);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (n === null) return;
        if (name.trim() && name.trim() !== a.name) actions.updateAccount(a.id, { name: name.trim() });
        actions.setBalance(a.id, n);
        toast('Cuenta cuadrada.', 'success');
        onDone();
      }}
    >
      <label className="lbl-field">
        <span>Nombre</span>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <AmountField value={v} onChange={setV} label={`Lo que de verdad tienes (${CURRENCY_SIGN[a.currency]})`} autoFocus />
      <p className="fine">Escribe lo que ves en tu banco o lo que cuentas en tu mano. Así todo cuadra.</p>
      <button type="submit" className="btn primary" disabled={n === null}>
        Guardar
      </button>
      {!used && a.balance === 0 && state.accounts.length > 1 && (
        <button
          type="button"
          className="btn danger"
          onClick={() => {
            actions.removeAccount(a.id);
            onDone();
          }}
        >
          <Icon name="trash" size={18} /> Quitar esta cuenta
        </button>
      )}
    </form>
  );
}

function NewAccount({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<Currency>('BOB');
  const [kind, setKind] = useState<AccountKind>('banco');
  const [v, setV] = useState('');
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        actions.addAccount({ name: name.trim(), currency, kind, balance: parseAmount(v) ?? 0 });
        onDone();
      }}
    >
      <label className="lbl-field">
        <span>Nombre</span>
        <input className="field" placeholder="BNB, Yape, Binance…" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <div className="segmented" role="radiogroup" aria-label="Moneda">
        {(['BOB', 'PEN'] as Currency[]).map((c) => (
          <button key={c} type="button" role="radio" aria-checked={currency === c} onClick={() => setCurrency(c)}>
            {c === 'BOB' ? 'Bolivianos' : 'Soles'}
          </button>
        ))}
      </div>
      <label className="lbl-field">
        <span>Tipo</span>
        <select className="field" value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
          {(Object.keys(KIND_LABEL) as AccountKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <AmountField value={v} onChange={setV} label="Saldo de hoy" />
      <button type="submit" className="btn primary" disabled={!name.trim()}>
        Agregar
      </button>
    </form>
  );
}

function MoveForm({ state, today, onDone }: { state: AppState; today: ISODate; onDone: () => void }) {
  const [from, setFrom] = useState(state.accounts.find((a) => a.kind === 'banco')?.id ?? state.accounts[0]?.id ?? '');
  const [to, setTo] = useState(state.accounts.find((a) => a.kind === 'efectivo')?.id ?? state.accounts[1]?.id ?? '');
  const [v, setV] = useState('');
  const n = parseAmount(v);
  const a = accountOf(state, from);
  const b = accountOf(state, to);
  const received = n && a && b ? convert(n, a.currency, b.currency, state.settings.rate) : 0;
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (!n || from === to) return;
        actions.transfer(today, from, to, n, received);
        toast('Listo, plata movida.', 'success');
        onDone();
      }}
    >
      <AccountSelect state={state} value={from} onChange={setFrom} label="Sale de" />
      <AccountSelect state={state} value={to} onChange={setTo} label="Entra a" />
      <AmountField value={v} onChange={setV} label={`Monto (${a ? CURRENCY_SIGN[a.currency] : 'Bs'})`} />
      {n && a && b && a.currency !== b.currency && (
        <p className="fine">
          Entran {money(received, b.currency)} (cambio {state.settings.rate}).
        </p>
      )}
      <button type="submit" className="btn primary" disabled={!n || from === to}>
        Mover
      </button>
    </form>
  );
}
