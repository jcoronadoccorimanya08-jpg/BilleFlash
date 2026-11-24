import { useState } from 'react';
import { AccountSelect, AmountField } from './bf';
import { Icon } from './Icon';
import { ConfirmDialog, SectionTitle, Sheet } from './ui';
import { CURRENCY_SIGN } from '../lib/config';
import { formatShort, type ISODate } from '../lib/dates';
import { mainOf, goalLeft, goalPerQuincena, money, parseAmount, unassignedSaving } from '../lib/engine';
import { toast } from '../lib/feedback';
import { actions } from '../lib/store';
import type { AppState, Goal } from '../lib/types';

/** Tus metas de ahorro: cuánto llevas, cuánto falta y cuánto apartar por quincena para llegar a tiempo. */
export function GoalsSection({ state, today }: { state: AppState; today: ISODate }) {
  const [edit, setEdit] = useState<Goal | 'new' | null>(null);
  const [put, setPut] = useState<Goal | null>(null);
  const [take, setTake] = useState<Goal | null>(null);
  const free = unassignedSaving(state);
  const days = state.settings.quincena.days;
  return (
    <>
      <SectionTitle aside={free > 0 ? `Sin asignar: ${money(free)}` : undefined}>Mis metas de ahorro</SectionTitle>
      {state.goals.length === 0 && <p className="muted">Ponle nombre a tu ahorro: un fondo de emergencia, pagar algo, comprar algo. Cada quincena el ahorro se reparte solo.</p>}
      {state.goals.map((g) => {
        const pct = g.target > 0 ? Math.min(100, (g.saved / g.target) * 100) : 0;
        const per = goalPerQuincena(g, today, days);
        const done = goalLeft(g) <= 0;
        return (
          <div key={g.id} className={`card bf-goal ${g.main ? 'main' : ''}`}>
            <div className="bf-debt-head">
              <div>
                <b>
                  {g.main ? '⭐ ' : ''}
                  {g.name}
                </b>
                {g.deadline && <span className="muted"> · para el {formatShort(g.deadline)}</span>}
              </div>
              <button type="button" className="icon-btn" aria-label={`Editar ${g.name}`} onClick={() => setEdit(g)}>
                <Icon name="pencil" size={18} />
              </button>
            </div>
            <div className="bf-debt-amt">
              <b>{money(g.saved)}</b>
              <span className="muted"> de {money(g.target)} · {Math.round(pct)} %</span>
            </div>
            <div className="bf-bar ok" aria-hidden="true">
              <span style={{ width: `${pct}%` }} />
            </div>
            <p className="fine">{done ? '¡Meta cumplida! 🎉' : per ? `Para llegar a tiempo: aparta ${money(per.per)} por quincena (${per.quincenas} ${per.quincenas === 1 ? 'quincena' : 'quincenas'}).` : `Te faltan ${money(goalLeft(g))}.`}</p>
            <div className="btn-row">
              <button type="button" className="btn primary" onClick={() => setPut(g)}>
                Apartar
              </button>
              <button type="button" className="btn" disabled={g.saved <= 0} onClick={() => setTake(g)}>
                Usar
              </button>
              {!g.main && (
                <button type="button" className="btn ghost" onClick={() => actions.setMainGoal(g.id)}>
                  ⭐ Principal
                </button>
              )}
            </div>
          </div>
        );
      })}
      <button type="button" className="btn ghost" onClick={() => setEdit('new')}>
        <Icon name="plus" size={18} /> Nueva meta
      </button>

      <Sheet open={Boolean(edit)} title={edit === 'new' ? 'Nueva meta' : edit ? `Editar ${edit.name}` : ''} onClose={() => setEdit(null)}>
        {edit && <GoalForm goal={edit === 'new' ? null : edit} onDone={() => setEdit(null)} />}
      </Sheet>
      <Sheet open={Boolean(put)} title={put ? `Apartar para ${put.name}` : ''} onClose={() => setPut(null)}>
        {put && (
          <MoveGoal
            state={state}
            initial={Math.min(goalLeft(put), free > 0 ? free : goalLeft(put))}
            label="De dónde sale"
            noneLabel={`De mi ahorro sin asignar (${money(Math.max(0, free))})`}
            confirm="Apartar"
            onDone={(n, acc) => {
              actions.addToGoal(put.id, today, n, acc);
              toast(`${money(n)} para ${put.name}.`, 'success');
              setPut(null);
            }}
          />
        )}
      </Sheet>
      <Sheet open={Boolean(take)} title={take ? `Usar de ${take.name}` : ''} onClose={() => setTake(null)}>
        {take && (
          <MoveGoal
            state={state}
            initial={take.saved}
            label="A dónde va"
            noneLabel="Se queda en mi ahorro (sin asignar)"
            confirm="Usar"
            onDone={(n, acc) => {
              actions.takeFromGoal(take.id, today, Math.min(n, take.saved), acc);
              toast('Listo.', 'success');
              setTake(null);
            }}
          />
        )}
      </Sheet>
    </>
  );
}

function MoveGoal({ state, initial, label, noneLabel, confirm, onDone }: { state: AppState; initial: number; label: string; noneLabel: string; confirm: string; onDone: (n: number, acc: string | undefined) => void }) {
  const [v, setV] = useState(initial > 0 ? String(initial) : '');
  const [acc, setAcc] = useState('');
  const n = parseAmount(v);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (n) onDone(n, acc || undefined);
      }}
    >
      <AmountField value={v} onChange={setV} label={`Monto (${CURRENCY_SIGN[mainOf(state)]})`} autoFocus />
      <AccountSelect state={state} value={acc} onChange={setAcc} label={label} allowNone noneLabel={noneLabel} />
      <button type="submit" className="btn primary" disabled={!n}>
        {confirm}
      </button>
    </form>
  );
}

function GoalForm({ goal, onDone }: { goal: Goal | null; onDone: () => void }) {
  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState(goal ? String(goal.target) : '');
  const [hasDate, setHasDate] = useState(Boolean(goal?.deadline));
  const [date, setDate] = useState(goal?.deadline ?? '');
  const [del, setDel] = useState(false);
  const t = parseAmount(target);
  const ok = name.trim() && t && (!hasDate || date);
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        const data = { name: name.trim(), target: t!, deadline: hasDate && date ? date : undefined };
        if (goal) actions.updateGoal(goal.id, data);
        else actions.addGoal(data);
        onDone();
      }}
    >
      <label className="lbl-field">
        <span>Para qué</span>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Fondo de emergencia, pagar…, comprar…" autoFocus />
      </label>
      <AmountField value={target} onChange={setTarget} label="Cuánto quieres juntar" />
      <label className="bf-check">
        <input type="checkbox" checked={hasDate} onChange={(e) => setHasDate(e.target.checked)} />
        <span>Con fecha (la app te dice cuánto apartar cada quincena)</span>
      </label>
      {hasDate && (
        <label className="lbl-field">
          <span>Para cuándo</span>
          <input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      )}
      <button type="submit" className="btn primary" disabled={!ok}>
        Guardar
      </button>
      {goal && (
        <button type="button" className="btn danger" onClick={() => setDel(true)}>
          <Icon name="trash" size={18} /> Quitar esta meta
        </button>
      )}
      <ConfirmDialog
        open={del}
        onClose={() => setDel(false)}
        title="¿Quitar esta meta?"
        body="Lo que apartaste no se pierde: vuelve a tu ahorro, sin asignar."
        confirmLabel="Quitar"
        danger
        onConfirm={() => {
          if (goal) actions.deleteGoal(goal.id);
          onDone();
        }}
      />
    </form>
  );
}
