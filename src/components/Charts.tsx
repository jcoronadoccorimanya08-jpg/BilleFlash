import { useState } from 'react';
import { formatShort, weekdayInitial } from '../lib/dates';
import { CATEGORIES, money, shotBs, shotPen, type DayBar } from '../lib/engine';
import type { Category, CapitalShot } from '../lib/types';

/**
 * En qué se te va: una barra por categoría (de mayor a menor), con su nombre y su monto escritos.
 * Un solo color: la identidad la da el texto, no el color.
 */
export function CategoryBars({ data }: { data: Record<Category, number> }) {
  const total = Object.values(data).reduce((s, n) => s + n, 0);
  const rows = CATEGORIES.map((c) => ({ c, n: data[c.id] })).filter((r) => r.n > 0).sort((a, b) => b.n - a.n);
  if (!rows.length) return <p className="muted">Todavía no hay gastos en esta quincena.</p>;
  const max = rows[0]!.n;
  return (
    <div className="bf-cats" role="table" aria-label="Gastos por categoría">
      {rows.map(({ c, n }) => (
        <div key={c.id} className="bf-cat-row" role="row">
          <span className="bf-cat-name" role="cell">
            {c.label}
          </span>
          <span className="bf-cat-track" role="cell" aria-hidden="true">
            <span style={{ width: `${Math.max(2, (n / max) * 100)}%` }} />
          </span>
          <span className="bf-cat-val" role="cell">
            {money(n)} <small>{Math.round((n / total) * 100)} %</small>
          </span>
        </div>
      ))}
    </div>
  );
}

/** Cada día: lo gastado (barra) contra tu límite (línea punteada). En rojo, los días que te pasaste. */
export function DayBars({ data }: { data: DayBar[] }) {
  const [sel, setSel] = useState<number | null>(null);
  if (!data.length) return null;
  const W = 340;
  const H = 150;
  const pad = { top: 12, bottom: 22, left: 4, right: 4 };
  const max = Math.max(1, ...data.map((d) => Math.max(d.spent, d.limit))) * 1.1;
  const slot = (W - pad.left - pad.right) / data.length;
  const bw = Math.min(16, slot - 4);
  const y = (v: number) => pad.top + (1 - v / max) * (H - pad.top - pad.bottom);
  const base = y(0);
  const limitPath = data.map((d, i) => `${i ? 'L' : 'M'}${pad.left + slot * i + 1},${y(d.limit)} H${pad.left + slot * (i + 1) - 1}`).join(' ');
  const s = sel !== null ? data[sel] : null;
  return (
    <div className="bf-days">
      <div className="bf-legend" aria-hidden="true">
        <span>
          <i className="sw ok" /> Gastado
        </span>
        <span>
          <i className="sw over" /> Te pasaste
        </span>
        <span>
          <i className="sw line" /> Tu límite
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="bf-days-svg" role="img" aria-label="Gastado cada día contra tu límite">
        <line x1={0} x2={W} y1={base} y2={base} className="bf-axis" />
        {data.map((d, i) => {
          const x = pad.left + slot * i + (slot - bw) / 2;
          const top = y(d.spent);
          const over = d.spent > d.limit + 0.001;
          const h = Math.max(0, base - top);
          return (
            <g key={d.date} onClick={() => setSel(sel === i ? null : i)} className="bf-day-g">
              <rect x={pad.left + slot * i} y={pad.top} width={slot} height={H - pad.top} fill="transparent" />
              {h > 0 && <path d={`M${x},${base} V${top + 4} Q${x},${top} ${x + 4},${top} H${x + bw - 4} Q${x + bw},${top} ${x + bw},${top + 4} V${base} Z`} className={over ? 'bf-bar-over' : 'bf-bar-ok'} opacity={sel === null || sel === i ? 1 : 0.45} />}
              <text x={pad.left + slot * (i + 0.5)} y={H - 6} textAnchor="middle" className="bf-tick">
                {weekdayInitial(d.date)}
              </text>
            </g>
          );
        })}
        <path d={limitPath} className="bf-limit-line" />
      </svg>
      <p className="fine bf-tip" aria-live="polite">
        {s ? `${formatShort(s.date)}: gastaste ${money(s.spent)} de ${money(s.limit)}${s.spent > s.limit ? ` (te pasaste ${money(s.spent - s.limit)})` : ''}.` : 'Toca un día para ver cuánto gastaste.'}
      </p>
    </div>
  );
}

type Cur = 'BOB' | 'PEN' | 'USD';

/** La curva de tu capital, foto por foto, en Bs, soles o dólares. Toca un punto para ver el valor. */
export function CapitalCurve({ shots, usdRate }: { shots: CapitalShot[]; usdRate?: number }) {
  const [cur, setCur] = useState<Cur>('BOB');
  const [sel, setSel] = useState<number | null>(null);
  if (shots.length < 2) return <p className="muted">La curva aparece desde tu segunda foto del capital.</p>;
  const value = (s: CapitalShot) => (cur === 'BOB' ? shotBs(s) : cur === 'PEN' ? shotPen(s) : (s.usd ?? usdRate) ? shotPen(s) / (s.usd ?? usdRate)! : NaN);
  const vals = shots.map(value);
  const ok = vals.every((v) => Number.isFinite(v));
  const fmt = (v: number) => (cur === 'USD' ? `$ ${v.toFixed(2)}` : money(v, cur === 'PEN' ? 'PEN' : 'BOB'));
  const W = 340;
  const H = 160;
  const pad = { top: 14, bottom: 20, left: 6, right: 6 };
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || Math.abs(max) || 1;
  const x = (i: number) => pad.left + (i / (vals.length - 1)) * (W - pad.left - pad.right);
  const y = (v: number) => pad.top + (1 - (v - (min - span * 0.08)) / (span * 1.16)) * (H - pad.top - pad.bottom);
  const line = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  const area = `${line} L${x(vals.length - 1)},${H - pad.bottom} L${x(0)},${H - pad.bottom} Z`;
  const s = (sel !== null ? shots[sel] : undefined) ?? shots[shots.length - 1]!;
  const si = sel ?? shots.length - 1;
  return (
    <div className="bf-curve">
      <div className="segmented" role="radiogroup" aria-label="Moneda de la curva">
        {(
          [
            ['BOB', 'Bs'],
            ['PEN', 'Soles'],
            ['USD', 'Dólares'],
          ] as [Cur, string][]
        ).map(([c, l]) => (
          <button key={c} type="button" role="radio" aria-checked={cur === c} disabled={c === 'USD' && !usdRate && !shots.some((x) => x.usd)} onClick={() => setCur(c)}>
            {l}
          </button>
        ))}
      </div>
      {ok ? (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="bf-curve-svg" role="img" aria-label="Tu capital a lo largo del tiempo">
            <path d={area} className="bf-curve-area" />
            <path d={line} className="bf-curve-line" />
            <line x1={x(si)} x2={x(si)} y1={pad.top} y2={H - pad.bottom} className="bf-cursor" />
            <circle cx={x(si)} cy={y(vals[si]!)} r={5} className="bf-curve-dot" />
            {vals.map((_, i) => (
              <rect key={i} x={x(i) - (W / vals.length) / 2} y={0} width={W / vals.length} height={H} fill="transparent" onClick={() => setSel(i)} />
            ))}
            <text x={pad.left} y={H - 5} className="bf-tick">
              {formatShort(shots[0]!.date)}
            </text>
            <text x={W - pad.right} y={H - 5} textAnchor="end" className="bf-tick">
              {formatShort(shots[shots.length - 1]!.date)}
            </text>
          </svg>
          <p className="fine bf-tip" aria-live="polite">
            {formatShort(s.date)} {s.time}: <b>{fmt(value(s))}</b> · en mano {money(s.enMano)} · te deben {money(s.meDeben)} · debes {money(s.debo)}
          </p>
        </>
      ) : (
        <p className="muted">Pon el tipo del dólar en Cuentas para ver la curva en dólares.</p>
      )}
    </div>
  );
}
