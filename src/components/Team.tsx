import { useRef, useState } from 'react';
import { CategoryBars, DayBars } from './Charts';
import { Icon } from './Icon';
import { ConfirmDialog, SectionTitle, Sheet } from './ui';
import { canShareFiles, downloadBackupText, shareBackupText } from '../lib/backup';
import { buildSummary, goalPct, openTeamFile, peekTeamFile, sealForTeam, teamFileName, type CoachSummary } from '../lib/coach';
import { CATEGORIES, categoryInfo, money } from '../lib/engine';
import { formatShort, type ISODate } from '../lib/dates';
import { toast } from '../lib/feedback';
import { actions } from '../lib/store';
import type { AppState, Category, TeamMember } from '../lib/types';

async function shareText(text: string, name: string) {
  if (canShareFiles()) await shareBackupText(text, name);
  else downloadBackupText(text, name);
}

/** Pide el texto de un archivo (elegido o pegado). */
function useFilePicker(onText: (t: string) => void) {
  const ref = useRef<HTMLInputElement>(null);
  const input = (
    <input
      ref={ref}
      type="file"
      accept=".txt,text/plain"
      hidden
      onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (f) onText(await f.text());
      }}
    />
  );
  return { input, pick: () => ref.current?.click() };
}

// ------------------------------------------------------------------ Lado de quien manda su resumen

/** «Mi entrenador»: tu código de equipo, mandar tu resumen y leer sus retos. */
export function MyCoach({ state, now }: { state: AppState; now: Date }) {
  const s = state.settings;
  const [code, setCode] = useState(s.teamCode ?? '');
  const [paste, setPaste] = useState<string | null>(null);
  const read = async (text: string) => {
    if (!s.teamCode) return toast('Primero guarda tu código de equipo.', 'error');
    if (peekTeamFile(text) !== 'coach-note') return toast('Ese archivo no es un mensaje de tu entrenador.', 'error');
    const r = await openTeamFile(text, s.teamCode);
    const note = r?.data as { text?: string; at?: string } | undefined;
    if (!note?.text) return toast('No se pudo abrir: revisa que tu código sea el mismo que el de tu entrenador.', 'error');
    actions.setCoachNote({ text: String(note.text).slice(0, 280), at: String(note.at ?? '') });
    toast('Mensaje de tu entrenador guardado: lo ves en Hoy.', 'success');
    setPaste(null);
  };
  const file = useFilePicker((t) => void read(t));
  return (
    <>
      <SectionTitle>Mi entrenador</SectionTitle>
      <section className="card stack">
        <p className="fine">Tú decides qué y cuándo compartir. El resumen va cifrado con un código que solo tú y tu entrenador saben: si alguien más lo ve en WhatsApp, no lo puede abrir.</p>
        <label className="lbl-field">
          <span>Código de equipo (el mismo que tu entrenador)</span>
          <input className="field" value={code} onChange={(e) => setCode(e.target.value)} onBlur={() => actions.setTeamCode(code)} placeholder="Una palabra o frase que acuerden" autoComplete="off" />
        </label>
        <button
          type="button"
          className="btn primary"
          disabled={!code.trim()}
          onClick={async () => {
            actions.setTeamCode(code);
            try {
              const text = await sealForTeam('coach-summary', buildSummary(state, now), code);
              await shareText(text, teamFileName('coach-summary', s.nick ?? 'yo', buildSummary(state, now).today));
              toast('Resumen listo para mandar. 💪', 'success');
            } catch {
              toast('No se pudo preparar el resumen.', 'error');
            }
          }}
        >
          <Icon name="share" size={18} /> Mandar mi resumen a mi entrenador
        </button>
        <div className="btn-row">
          <button type="button" className="btn" onClick={file.pick}>
            <Icon name="upload" size={18} /> Abrir mensaje de mi entrenador
          </button>
          <button type="button" className="btn" onClick={() => setPaste('')}>
            Pegar texto
          </button>
        </div>
        {file.input}
        {paste !== null && (
          <div className="stack">
            <textarea className="field" rows={3} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Pega aquí el texto del mensaje" />
            <button type="button" className="btn primary" disabled={!paste.trim()} onClick={() => void read(paste)}>
              Abrir
            </button>
          </div>
        )}
      </section>
    </>
  );
}

// ------------------------------------------------------------------ Lado del entrenador

/** «Mi equipo»: las personas que te mandan su resumen. */
export function MyTeam({ state, today }: { state: AppState; today: ISODate }) {
  const [add, setAdd] = useState(false);
  return (
    <>
      <SectionTitle>Mi equipo</SectionTitle>
      {state.team.length === 0 && <p className="muted">¿Eres entrenador de alguien? Agrégala con el mismo código de equipo que ella puso en su app. Cuando te mande su resumen por WhatsApp, lo abres aquí.</p>}
      {state.team.map((m) => (
        <MemberCard key={m.id} m={m} today={today} />
      ))}
      <button type="button" className="btn ghost" onClick={() => setAdd(true)}>
        <Icon name="plus" size={18} /> Agregar a mi equipo
      </button>
      <Sheet open={add} title="Agregar a mi equipo" onClose={() => setAdd(false)}>
        <AddMember onDone={() => setAdd(false)} />
      </Sheet>
    </>
  );
}

function AddMember({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || !code.trim()) return;
        actions.addMember(name, code);
        onDone();
      }}
    >
      <label className="lbl-field">
        <span>Nombre</span>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <label className="lbl-field">
        <span>Código de equipo (el mismo que ella puso)</span>
        <input className="field" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
      </label>
      <button type="submit" className="btn primary" disabled={!name.trim() || !code.trim()}>
        Agregar
      </button>
    </form>
  );
}

function MemberCard({ m, today }: { m: TeamMember; today: ISODate }) {
  const [paste, setPaste] = useState<string | null>(null);
  const [note, setNote] = useState(false);
  const [del, setDel] = useState(false);
  const read = async (text: string) => {
    if (peekTeamFile(text) !== 'coach-summary') return toast('Ese archivo no es un resumen.', 'error');
    const r = await openTeamFile(text, m.code);
    if (!r) return toast('No se pudo abrir: el código no coincide con el de ella.', 'error');
    actions.saveMemberSummary(m.id, r.data);
    toast(`Resumen de ${m.name} actualizado.`, 'success');
    setPaste(null);
  };
  const file = useFilePicker((t) => void read(t));
  const sum = m.last as CoachSummary | undefined;
  return (
    <div className="card bf-member">
      <div className="bf-debt-head">
        <div>
          <b>{m.name}</b>
          <span className="muted"> · {m.lastAt ? `resumen del ${formatShort(sum?.today ?? today)}` : 'sin resumen todavía'}</span>
        </div>
        <button type="button" className="icon-btn" aria-label={`Quitar a ${m.name}`} onClick={() => setDel(true)}>
          <Icon name="trash" size={18} />
        </button>
      </div>
      {sum && <MemberView s={sum} />}
      <div className="btn-row">
        <button type="button" className="btn primary" onClick={file.pick}>
          <Icon name="upload" size={18} /> Abrir su resumen
        </button>
        <button type="button" className="btn" onClick={() => setPaste('')}>
          Pegar texto
        </button>
        <button type="button" className="btn" onClick={() => setNote(true)}>
          💬 Mandar un reto
        </button>
      </div>
      {file.input}
      {paste !== null && (
        <div className="stack">
          <textarea className="field" rows={3} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Pega aquí el texto del resumen" />
          <button type="button" className="btn primary" disabled={!paste.trim()} onClick={() => void read(paste)}>
            Abrir
          </button>
        </div>
      )}
      <Sheet open={note} title={`Reto o nota para ${m.name}`} onClose={() => setNote(false)}>
        <NoteForm m={m} today={today} onDone={() => setNote(false)} />
      </Sheet>
      <ConfirmDialog open={del} onClose={() => setDel(false)} title={`¿Quitar a ${m.name}?`} body="Se borra su último resumen de tu app. Su app no cambia." confirmLabel="Quitar" danger onConfirm={() => actions.removeMember(m.id)} />
    </div>
  );
}

function NoteForm({ m, today, onDone }: { m: TeamMember; today: ISODate; onDone: () => void }) {
  const [text, setText] = useState('');
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        try {
          const sealed = await sealForTeam('coach-note', { text: text.trim().slice(0, 280), at: new Date().toISOString() }, m.code);
          await shareText(sealed, teamFileName('coach-note', m.name, today));
          onDone();
        } catch {
          toast('No se pudo preparar el mensaje.', 'error');
        }
      }}
    >
      <textarea className="field" rows={3} maxLength={280} value={text} onChange={(e) => setText(e.target.value)} placeholder="Esta semana: antojos menos de S/ 15 💪" autoFocus />
      <p className="fine">Se manda cifrado con su código. Ella lo abre en su app y lo ve en Hoy.</p>
      <button type="submit" className="btn primary" disabled={!text.trim()}>
        Preparar y mandar
      </button>
    </form>
  );
}

/** Todo lo que ella compartió: su día, su alcancía, sus metas, en qué se le va y cada gasto. */
function MemberView({ s }: { s: CoachSummary }) {
  const [all, setAll] = useState(false);
  const c = s.cur;
  const byCat = Object.fromEntries(CATEGORIES.map((x) => [x.id, 0])) as Record<Category, number>;
  const from = s.days[0]?.d ?? s.today;
  for (const e of s.expenses) if (e.d >= from) byCat[e.cat] = Math.round((byCat[e.cat] + e.a) * 100) / 100;
  const within = s.spentToday <= s.limit + 0.001;
  return (
    <div className="stack bf-member-view">
      <div className="tiles bf-tiles">
        <div className="tile">
          <b className={within ? '' : 'over'}>{money(s.spentToday, c)}</b>
          <span>Hoy, de {money(s.limit, c)}</span>
        </div>
        <div className="tile">
          <b>{s.streak}</b>
          <span>Noches seguidas{s.closedToday !== null ? ` · hoy ${s.closedToday} %` : ''}</span>
        </div>
        <div className="tile">
          <b>🐷 {money(s.piggy.total, c)}</b>
          <span>
            +{money(s.piggy.week, c)} semana · +{money(s.piggy.month, c)} mes
          </span>
        </div>
        <div className="tile">
          <b>{money(s.capital.capital, c)}</b>
          <span>Su capital</span>
        </div>
      </div>
      {s.goals.map((g) => (
        <div key={g.name} className="bf-goal-mini">
          <span>
            {g.main ? '⭐ ' : ''}
            {g.name}: {money(g.saved, c)} de {money(g.target, c)} ({goalPct(g)} %)
          </span>
          <span className="bf-bar ok" aria-hidden="true">
            <span style={{ width: `${goalPct(g)}%` }} />
          </span>
        </div>
      ))}
      <h3 className="card-title">¿En qué se le va? (14 días)</h3>
      <CategoryBars data={byCat} />
      <h3 className="card-title">Cada día contra su límite</h3>
      <DayBars data={s.days.map((d) => ({ date: d.d, spent: d.s, limit: s.limit }))} />
      <h3 className="card-title">Sus gastos</h3>
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
            {(all ? s.expenses : s.expenses.slice(0, 12)).map((e, i) => (
              <tr key={i}>
                <td>{formatShort(e.d)}</td>
                <td>{e.t}</td>
                <td>
                  {e.desc} <small className="muted">{categoryInfo(e.cat).label}</small>
                </td>
                <td>{money(e.a, c)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {s.expenses.length > 12 && (
        <button type="button" className="btn ghost" onClick={() => setAll(!all)}>
          {all ? 'Ver menos' : `Ver los ${s.expenses.length} gastos`}
        </button>
      )}
      {s.piggy.moves.length > 0 && (
        <>
          <h3 className="card-title">Su alcancía, moneda por moneda</h3>
          <div className="bf-hist-wrap">
            <table className="bf-hist">
              <tbody>
                {s.piggy.moves.slice(0, 15).map((m, i) => (
                  <tr key={i}>
                    <td>{formatShort(m.d)}</td>
                    <td>{m.t}</td>
                    <td>{m.what}</td>
                    <td className={m.a >= 0 ? 'ok' : 'over'}>
                      {m.a >= 0 ? '+' : '−'}
                      {money(Math.abs(m.a), c)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
