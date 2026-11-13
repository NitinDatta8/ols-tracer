// The physical view's procedures (bridge/procedures.mjs): the Procedures button in its header, with a dot while one
// waits for Approve (amber) or runs (green), and its panel over the stage, the same size whatever it shows, in three
// parts: the box's procedures; the one picked, or the one asked for on the box, with its params and the exact lines;
// and what the one asked for did, step by step. Under the middle, always in the same place: Run or Request, the
// hostname to type and Approve, and Cancel, each enabled only when it applies.
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { bridge, ME } from './bridge';
import { active, levelWhy, paramProblem, procedureItems, restoreOf, startParams, stepsOf, type Asked, type BoxProcedures, type Level } from './procedures';

/** What the bridge said of the box's procedures: the list, or why there is none. */
export interface Got { list: BoxProcedures | null; error: string }

const query = (host: string) => `host=${encodeURIComponent(host)}&by=${encodeURIComponent(ME)}`;
const time = (at: string | null | undefined) => (at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');
const STATE: Record<Asked['state'], string> = { pending: 'waiting for Approve', running: 'running', done: 'done', failed: 'failed', cancelled: 'cancelled', expired: 'expired' };
/** Who asked or approved, as a person reads it: this view, another, or a Codex session. */
const who = (by: string) => (by === ME ? 'this view' : by.startsWith('view:') ? 'another view' : by.startsWith('codex:') ? 'Codex' : by);
const NO_BRIDGE = 'Bridge not running: npm run bridge';

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
  const [id, setId] = useState(pick);
  useEffect(() => { if (pick) setId(pick); }, [pick]);
  const item = items.find((i) => i.def.id === id);
  const def = item?.def;
  const [params, setParams] = useState<Record<string, string>>({});
  // A procedure picked, or the card changed, starts from its defaults there. Keyed by id: the list is fetched anew each second.
  const defId = def?.id;
  useEffect(() => { setParams(def ? startParams(def, { chassis, slot }) : {}); }, [defId, chassis, slot]);
  const [typed, setTyped] = useState('');
  const [said, setSaid] = useState(''); // why the bridge refused the last button
  const now = list?.current ?? null;
  const asked = active(now) ? now : null; // the one waiting or running: the middle shows it, and nothing else may start
  useEffect(() => setTyped(''), [asked?.ref]);

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
  const problem = def && Object.entries(def.params ?? {}).map(([k, spec]) => { const p = paramProblem(spec, params[k] ?? ''); return p && `${k}: ${p}`; }).find(Boolean);
  const cannot = asked ? `${asked.label} is ${STATE[asked.state]}: one at a time` : !def ? 'Pick a procedure' : item?.why ?? problem ?? undefined;

  return (
    <div className="procedures" onContextMenu={(e) => e.stopPropagation()}>
      <div className="procedures-head">
        <b>Procedures</b>
        <small className="muted">{slot ? `at card ${chassis}-${slot}` : 'at the chassis'}{list?.stream ? ` · ${list.stream}` : ''} · {host}</small>
        <span className="spacer" />
        <button onClick={onClose} aria-label="Close procedures">✕</button>
      </div>
      <nav className="procedures-list" aria-label="The box's procedures">
        {/* Each says only why it is not for here; why none can run now (no box, one already on) is said once, in the middle. */}
        {items.map(({ def: d, why }) => (
          <button key={d.id} className={d.id === id ? 'on' : ''} onClick={() => setId(d.id)} title={why}>
            {d.label}
            <small>{d.level} · {d.tier}{levelWhy(d, level) ? ` · ${levelWhy(d, level)}` : ''}</small>
          </button>
        ))}
        {!items.length && <p className="muted">{error || (list ? 'No procedures for this box yet' : 'Asking the bridge…')}</p>}
      </nav>
      <section className="procedures-pick">
        <div className="procedures-body">
          {asked ? (
            <>
              <h4>{asked.label} <small className={`tier ${asked.tier}`}>{asked.tier}</small></h4>
              <p className="muted">
                {asked.state === 'pending' ? `Asked for by ${who(asked.by)} at ${time(asked.askedAt)}. It runs once a person approves it, typing the box's hostname.`
                  : `Running since ${time(asked.startedAt)}, asked for by ${who(asked.by)}${asked.approvedBy ? `, approved by ${who(asked.approvedBy)}` : ''}.`}
              </p>
              <ol className="lines">
                {asked.plan.pre.map((c) => <li key={`pre ${c.check}`}>check {c.check}: <code>{c.shows.join('; ')}</code></li>)}
                {asked.plan.steps.map((s, i) => (
                  <li key={i}>{'send' in s ? <><code>{s.send}</code>{s.drops && <small> · drops the session</small>}</>
                    : <>wait for {s.wait}, every {s.every} s, up to {s.timeout} s: <code>{s.shows.join('; ')}</code></>}</li>
                ))}
                {asked.plan.verify && <li>verify {asked.plan.verify.check}: <code>{asked.plan.verify.shows.join('; ')}</code></li>}
                {asked.plan.restore.length > 0 && <li>undo: <code>{asked.plan.restore.join('; ')}</code></li>}
              </ol>
            </>
          ) : def ? (
            <>
              <h4>{def.label} <small className={`tier ${def.tier}`}>{def.tier}</small></h4>
              <div className="params">
                {Object.entries(def.params ?? {}).map(([name, spec]) => (
                  <label key={name}>
                    {spec.label ?? name}
                    {spec.enum
                      ? <select value={params[name] ?? ''} onChange={(e) => setParams({ ...params, [name]: e.target.value })}>
                        {!spec.default && <option value="">…</option>}
                        {spec.enum.map((v) => <option key={v}>{v}</option>)}
                      </select>
                      : <input value={params[name] ?? ''} spellCheck={false} placeholder={spec.pattern} onChange={(e) => setParams({ ...params, [name]: e.target.value })} />}
                  </label>
                ))}
              </div>
              <ol className="lines">
                {(def.pre ?? []).map((c) => <li key={`pre ${c}`}>check {c}</li>)}
                {stepsOf(def, params).map((s, i) => (
                  <li key={i}>{'send' in s ? <><code>{s.send ?? '…'}</code>{s.drops && <small> · drops the session</small>}</> : <>wait for {s.wait}, every {s.every} s, up to {s.timeout} s</>}</li>
                ))}
                {def.verify && <li>verify {def.verify}</li>}
                {def.restore && <li>undo: <code>{restoreOf(def, params).map((l) => l ?? '…').join('; ')}</code></li>}
              </ol>
            </>
          ) : <p className="muted">Pick a procedure to see what it types on the box.</p>}
        </div>
        <p className="said" title={said}>{said || (cannot && !asked ? cannot : '\u00a0')}</p>
        <form className="actions" onSubmit={approve}>
          <button type="button" className="ask" disabled={!!cannot} onClick={ask}>{def?.tier === 'change' ? 'Request' : 'Run'}</button>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} disabled={asked?.state !== 'pending'} spellCheck={false}
            placeholder={asked?.state === 'pending' ? `Type ${hostname ?? "the box's hostname"} to approve` : 'Approve: type the hostname'} aria-label="The box's hostname, to approve" />
          <button className="primary" disabled={asked?.state !== 'pending' || !typed.trim()}>Approve</button>
          <button type="button" disabled={!asked} onClick={cancel}>Cancel</button>
        </form>
      </section>
      <section className="procedures-log" aria-live="polite">
        {now ? (
          <>
            <h4>{now.label}: {STATE[now.state]}</h4>
            <p className="progress">{now.waiting ? `Waiting for ${now.waiting.what === 'back' ? 'the box to come back' : now.waiting.what}${now.waiting.tries ? ` · try ${now.waiting.tries}` : ''} · until ${time(now.waiting.until)}${now.waiting.why ? ` · ${now.waiting.why}` : ''}` : now.cancelledBy ? (now.why ?? '').replace(`cancelled by ${now.cancelledBy}`, `Cancelled by ${who(now.cancelledBy)}`) : now.why ?? '\u00a0'}</p>
            <ol className="log">
              {now.log.map((e, i) => (
                <li key={i} className={e.ok ? 'ok' : 'bad'}><time>{time(e.at)}</time> {e.step} <code>{e.line ?? e.check ?? ''}</code>{e.why ? ` · ${e.why}` : ''}</li>
              ))}
            </ol>
            {now.sent.length > 0 && <p className="muted">Typed on the box: <code>{now.sent.join('; ')}</code></p>}
          </>
        ) : <p className="muted">Nothing asked for on this box yet.</p>}
      </section>
    </div>
  );
}
