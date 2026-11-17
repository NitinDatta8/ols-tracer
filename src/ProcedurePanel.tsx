// The physical view's procedures (bridge/procedures.mjs): the Procedures button in its header, with a dot while one
// waits for Approve (amber) or runs (green), and its panel over the stage, the same size whatever it shows. On the left
// the box's procedures by tier; on the right the one picked, or the one asked for on the box: its params, its steps,
// each marked as it goes, and what it found. Under them, always in the same place, one row says where it is and holds
// only what can be done now: Run or Request approval; the hostname and Approve; Cancel; or Run again.
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { bridge, ME } from './bridge';
import { active, draft, paramProblem, procedureItems, startParams, timeline, TIERS, type Asked, type BoxProcedures, type Level, type Row, type Tier } from './procedures';

/** What the bridge said of the box's procedures: the list, or why there is none. */
export interface Got { list: BoxProcedures | null; error: string }

const query = (host: string) => `host=${encodeURIComponent(host)}&by=${encodeURIComponent(ME)}`;
const time = (at: string | null | undefined) => (at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');
const STATE: Record<Asked['state'], string> = { pending: 'waiting for Approve', running: 'running', done: 'done', failed: 'failed', cancelled: 'cancelled', expired: 'expired' };
/** Who asked or approved, as a person reads it: this view, another, or a Codex session. */
const who = (by: string) => (by === ME ? 'this view' : by.startsWith('view:') ? 'another view' : by.startsWith('codex:') ? 'Codex' : by);
const NO_BRIDGE = 'Bridge not running: npm run bridge';
const pad = (n: number) => String(n).padStart(2, '0');
/** `s` seconds as a clock: 4:05, or 1:02:09. */
const clock = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`);
const since = (at: string) => clock(Math.max(0, Math.round((Date.now() - Date.parse(at)) / 1000)));
const left = (until: string) => `${clock(Math.max(0, Math.round((Date.parse(until) - Date.now()) / 1000)))} left`;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
const MARK: Record<Row['state'], string> = { todo: '○', now: '●', ok: '✓', bad: '✗' };
/** What a tier's procedure does to the box, said under its steps before it is asked for. */
const DOES: Record<Tier, string> = {
  read: 'It only reads the box.',
  reversible: 'It undoes itself when it ends, or is cancelled.',
  change: "A change: it runs once a person approves it here, typing the box's hostname.",
};

/**
 * The box's procedures, from the bridge: every second while `fast` (its panel is open) or one waits or runs, else every
 * 5 s while connected, so a change asked for from Codex shows soon; once while not. A reply that comes after a newer one
 * is dropped.
 */
export function useProcedures(host: string, connected: boolean, fast: boolean) {
  const [got, setGot] = useState<Got>({ list: null, error: '' });
  const asked = useRef(0);
  const get = useCallback(() => {
    if (!host) return;
    const n = ++asked.current;
    const take = (g: Got) => { if (n === asked.current) setGot(g); };
    bridge(`procedure?host=${encodeURIComponent(host)}`)
      .then(async (r) => take(r.ok ? { list: await r.json(), error: '' } : { list: null, error: (await r.text()).trim() }), () => take({ list: null, error: NO_BRIDGE }));
  }, [host]);
  const busy = active(got.list?.current);
  useEffect(() => {
    if (!host) return void setGot({ list: null, error: '' });
    get();
    if (!connected) return;
    const id = setInterval(get, fast || busy ? 1000 : 5000);
    return () => clearInterval(id);
  }, [host, connected, fast, busy, get]);
  return [got, get] as const;
}

/** The header's Procedures button: a dot while one waits for Approve or runs on the box. */
export function ProceduresButton({ current, open, onClick }: { current: Asked | null | undefined; open: boolean; onClick: () => void }) {
  return (
    <button className={['procs', active(current) && current.state, open && 'on'].filter(Boolean).join(' ')} onClick={onClick} aria-pressed={open}
      title={active(current) ? `${current.label}: ${STATE[current.state]}` : 'The box workflows the bridge runs: audits, reboots, upgrades'}>
      <span className="dot" />Procedures
    </button>
  );
}

/** Where one asked for is, in a word or two, for the pill by its name. */
function pill(p: Asked, findings: number) {
  if (p.state === 'running') return { cls: 'running', text: `Running · ${since(p.startedAt ?? p.askedAt)}` };
  if (p.state === 'pending') return { cls: 'pending', text: 'Waiting for Approve' };
  if (p.state === 'done') return findings ? { cls: 'found', text: `Done · ${plural(findings, 'finding')}` } : { cls: 'done', text: 'Done' };
  return { cls: p.state, text: p.state[0].toUpperCase() + p.state.slice(1) };
}

/** What the row under the steps says of one asked for: who asked, what it waits on, or how it ended. */
function where(p: Asked, hostname: string | null) {
  if (p.state === 'pending') return `Asked for by ${who(p.by)} at ${time(p.askedAt)}. Check its lines, then type ${hostname ?? "the box's hostname"} to approve.`;
  if (p.state === 'running') {
    const undo = p.tier === 'reversible' ? 'Cancel undoes it' : p.tier === 'change' ? 'Cancel stops it at its next step; what it typed stays on the box' : 'Cancel stops it';
    return `${p.approvedBy ? `Approved by ${who(p.approvedBy)}. ` : ''}${undo}.`;
  }
  if (p.state === 'done') return `Done at ${time(p.endedAt)}${p.approvedBy ? `, approved by ${who(p.approvedBy)}` : ''}.`;
  if (p.cancelledBy) return (p.why ?? '').replace(`cancelled by ${p.cancelledBy}`, `Cancelled by ${who(p.cancelledBy)}`);
  return p.why ?? STATE[p.state];
}

interface Props {
  host: string;
  /** The box's hostname, from its show system, to type to approve: null until it is known. */
  hostname: string | null;
  got: Got;
  refresh: () => void;
  /** Where it was opened: the chassis, or the card in `slot`. */
  slot: string | null;
  chassis: number;
  tester: boolean;
  connected: boolean;
  /** The procedure picked in the right-click menu, if it was opened from there. */
  pick: string | null;
  onClose: () => void;
}

export function ProceduresPanel({ host, hostname, got: { list, error }, refresh, slot, chassis, tester, connected, pick, onClose }: Props) {
  const level: Level = slot ? 'card' : 'chassis';
  const items = procedureItems(list, { level, tester, connected });
  const now = list?.current ?? null;
  const asked = active(now) ? now : null; // the one waiting or running: it is shown, and nothing else may start
  const [id, setId] = useState(pick);
  useEffect(() => { if (pick) setId(pick); }, [pick]);
  useEffect(() => { if (!id && now) setId(now.id); }, [id, now]); // opened with none picked: the one asked for last
  const shown = asked?.id ?? id;
  const item = items.find((i) => i.def.id === shown);
  const def = item?.def;
  // The one asked for last is shown as it went, until Run again puts it away (by its ref) for its params.
  const [putAway, setPutAway] = useState<string | null>(null);
  const result = now && now.id === shown && (asked || putAway !== now.ref) ? now : null;
  const [params, setParams] = useState<Record<string, string>>({});
  // A procedure picked, or the card changed, starts from its defaults there. Keyed by id: the list is fetched anew each second.
  const defId = def?.id;
  useEffect(() => { setParams(def ? startParams(def, { chassis, slot }) : {}); }, [defId, chassis, slot]);
  const [typed, setTyped] = useState('');
  const [said, setSaid] = useState(''); // why the bridge refused the last button
  useEffect(() => setTyped(''), [asked?.ref]);
  useEffect(() => setSaid(''), [shown]);

  const answer = async (r: Response) => {
    setSaid(r.ok ? '' : (await r.text()).trim());
    refresh();
  };
  const failed = () => setSaid(NO_BRIDGE);
  const ask = () => { if (def) bridge(`procedure?${query(host)}&id=${def.id}`, JSON.stringify(params)).then(answer, failed); };
  const approve = (e: FormEvent) => {
    e.preventDefault();
    if (asked) bridge(`procedure/approve?${query(host)}&ref=${asked.ref}`, typed.trim()).then(answer, failed);
  };
  const cancel = () => { if (asked) bridge(`procedure/cancel?${query(host)}&ref=${asked.ref}`, '').then(answer, failed); };
  const again = () => {
    if (!result) return;
    setPutAway(result.ref);
    setParams({ ...(def ? startParams(def, { chassis, slot }) : {}), ...result.params });
  };
  const problem = def && Object.entries(def.params ?? {}).map(([k, spec]) => { const p = paramProblem(spec, params[k] ?? ''); return p && `${spec.label ?? k}: ${p}`; }).find(Boolean);
  const cannot = def ? item?.why ?? problem ?? undefined : undefined;
  const { rows, findings } = result ? timeline(result) : { rows: def ? draft(def, params) : [], findings: [] };
  const values = result?.params ?? params;
  const tier = result?.tier ?? def?.tier;
  const state = result && pill(result, findings.length);

  return (
    <div className="procedures" onContextMenu={(e) => e.stopPropagation()}>
      <div className="procedures-head">
        <b>Procedures</b>
        <small className="muted">{slot ? `at card ${chassis}-${slot}` : 'at the chassis'}{list?.stream ? ` · ${list.stream}` : ''} · {host}</small>
        <span className="spacer" />
        <button onClick={onClose} aria-label="Close procedures">✕</button>
      </div>
      <nav className="procedures-list" aria-label="The box's procedures">
        {/* One line each, greyed with why in its title when it can't run here and now; picked, the right side says why. */}
        {(Object.keys(TIERS) as Tier[]).map((t) => {
          const of = items.filter((i) => i.def.tier === t);
          return of.length > 0 && (
            <div key={t} className="group">
              <h5 className={t}>{TIERS[t]}</h5>
              {of.map(({ def: d, why }) => (
                <button key={d.id} className={[d.id === shown && 'on', why && 'off'].filter(Boolean).join(' ')} title={why}
                  disabled={!!asked && d.id !== asked.id} onClick={() => setId(d.id)}>
                  <span>{d.label}{now?.id === d.id && <i className={`state ${now.state}`} title={STATE[now.state]} />}</span>
                  <small>{d.level}</small>
                </button>
              ))}
            </div>
          );
        })}
        {!items.length && <p className="muted">{error || (list ? 'No procedures for this box yet' : 'Asking the bridge…')}</p>}
      </nav>
      <section className="procedures-pick">
        <div className="pick-head">
          {def || result ? (
            <>
              <h4>{(result ?? def)!.label}</h4>
              {tier && <span className={`tier ${tier}`}>{tier}</span>}
              <span className="spacer" />
              {state && <span className={`pill ${state.cls}`}>{state.text}</span>}
            </>
          ) : <h4 className="muted">Pick a procedure to see what it types on the box</h4>}
        </div>
        <div className="params">
          {Object.entries(def?.params ?? {}).map(([name, spec]) => {
            const v = values[name] ?? '';
            const bad = !result && v !== '' && !!paramProblem(spec, v);
            return (
              <label key={name}>
                {spec.label ?? name}
                {spec.enum
                  ? <select value={v} disabled={!!result} onChange={(e) => setParams({ ...params, [name]: e.target.value })}>
                    {!spec.default && <option value="">…</option>}
                    {spec.enum.map((o) => <option key={o}>{o}</option>)}
                  </select>
                  : <input value={v} disabled={!!result} spellCheck={false} aria-invalid={bad} placeholder={spec.example ?? spec.pattern}
                    style={{ width: `${Math.min(46, Math.max(14, (spec.example ?? v).length + 2))}ch` }} onChange={(e) => setParams({ ...params, [name]: e.target.value.trim() })} />}
              </label>
            );
          })}
          {def && !Object.keys(def.params ?? {}).length && <span className="muted">No params</span>}
        </div>
        <div className="procedures-body">
          <ol className="steps">
            {rows.map((r, i) => (
              <li key={i} className={`${r.kind} ${r.state}`}>
                <span className="mark" aria-label={r.state}>{MARK[r.state]}</span>
                <span>
                  {r.kind !== 'send' && <span className="what">{r.what}</span>}
                  {(r.code !== null || r.kind === 'send' || r.kind === 'restore') && <code>{r.code ?? '…'}</code>}
                  {r.more && <small> · {r.more}</small>}
                  {r.state === 'now' && result?.waiting && (
                    <small className="note">{result.waiting.what === 'back' ? 'waiting for the box to come back' : `try ${result.waiting.tries}${result.waiting.why ? `: ${result.waiting.why}` : ''}`} · {left(result.waiting.until)}</small>
                  )}
                  {r.note && <small className="note">{r.note}</small>}
                </span>
                <time>{time(r.at)}</time>
              </li>
            ))}
          </ol>
          {findings.length > 0 && (
            <div className="findings">
              <h5>It found {plural(findings.length, 'thing')} to look at</h5>
              <ul>{findings.map((f, i) => <li key={i}>{f}</li>)}</ul>
            </div>
          )}
          {result && result.sent.length > 0 && <p className="muted typed">Typed on the box: <code>{result.sent.join('; ')}</code></p>}
        </div>
        <form className={`actions ${result?.state === 'pending' ? 'pending' : ''}`} onSubmit={approve}>
          <p className={`said ${said || (!result && cannot) || ['failed', 'expired'].includes(result?.state ?? '') ? 'bad' : ''}`} title={said || undefined}>
            {said || (result ? where(result, hostname) : def ? cannot ?? DOES[def.tier] : '\u00a0')}
          </p>
          {result?.state === 'pending' && (
            <>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} spellCheck={false} autoFocus
                placeholder={`Type ${hostname ?? "the box's hostname"}`} aria-label="The box's hostname, to approve" />
              <button className="danger" disabled={!typed.trim()}>Approve</button>
              <button type="button" onClick={cancel}>Cancel request</button>
            </>
          )}
          {result?.state === 'running' && <button type="button" onClick={cancel}>Cancel</button>}
          {result && !active(result) && <button type="button" className="primary" onClick={again}>Run again…</button>}
          {!result && def && <button type="button" className="primary" disabled={!!cannot} onClick={ask}>{def.tier === 'change' ? 'Request approval' : 'Run'}</button>}
        </form>
      </section>
    </div>
  );
}
