import { ReactFlowProvider } from '@xyflow/react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { CHASSIS_MIME, Canvas, ChassisIcon, RACK_MIME, RackIcon } from './Canvas';
import { byId } from './catalog';
import { catalogFor, streams } from './catalog-vite';
import { l0Problems } from './l0';
import { sha256, useLab } from './lab';
import { stateFor } from './live';
import { PhysicalView } from './PhysicalView';
import { path, sameEnd, validate } from './rules';
import { useCatalog, useLocked, useStore } from './store';
import { TermWindows } from './TermWindow';
import type { View } from './types';

const VIEWS: [View, string][] = [
  ['L0', 'Optical: every fiber and port'],
  ['L1', 'Line ports and line fibers only'],
  ['Data', 'Data ports, with dashed services between cards joined by L1 fibers'],
];

/**
 * The lab's lock, where the lab file has one: unlocking asks for its password, checked against the file's SHA-256 here,
 * and lasts until the page reloads. The password field keeps its place while hidden, so nothing moves.
 */
function Lock() {
  const lock = useStore((s) => s.topology?.lock);
  const unlocked = useStore((s) => s.unlocked);
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState('');
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { if (asking) field.current?.focus(); }, [asking]);
  const { setLab, notify } = useStore.getState();
  const unlock = async (e: FormEvent) => {
    e.preventDefault();
    const right = (await sha256(typed)) === lock?.sha256;
    setTyped('');
    if (!right) return notify('Wrong password: the lab stays locked');
    setAsking(false);
    setLab({ unlocked: true });
  };
  return (
    <form className="lock" onSubmit={unlock} style={{ visibility: lock ? 'visible' : 'hidden' }}>
      <button type="button" className={unlocked ? 'on' : ''} aria-pressed={unlocked} onClick={() => (unlocked ? setLab({ unlocked: false }) : setAsking(!asking))}
        title={unlocked ? 'Unlocked until the page reloads: chassis and racks can be added, deleted and moved. Click to lock'
          : 'Locked: no chassis or rack can be added, deleted or moved, nor a box IP changed. Cards, pluggables, fibers and bays stay free. Click to unlock'}>
        {unlocked ? '🔓 Unlocked' : '🔒 Locked'}
      </button>
      <input ref={field} type="password" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setAsking(false); }}
        placeholder="Password, then Enter" aria-label="The lab's password" autoComplete="off" style={{ visibility: asking && !unlocked ? 'visible' : 'hidden' }} />
    </form>
  );
}

/** The lab's corporation, its lock, whether it can't be changed now, and the views. */
function TopBar() {
  const t = useStore((s) => s.topology);
  const view = useStore((s) => s.view);
  const readOnly = useStore((s) => s.readOnly);
  const { setView } = useStore.getState();
  return (
    <header className="topbar">
      <strong>OLS Tracer</strong>
      <span className="stream" title="The lab's corporation: the palette shows only its hardware">{byId(streams, t?.stream)?.name}</span>
      <Lock />
      <small className="lab-state" title={readOnly ?? undefined}>{readOnly ? 'Read-only' : '\u00a0'}</small>
      <span className="spacer" />
      {t && VIEWS.map(([v, title]) => (
        <button key={v} className={v === view ? 'on' : ''} title={title} onClick={() => setView(v)}>{v}</button>
      ))}
    </header>
  );
}

/** Bottom-left device palette, grouped by category like Packet Tracer, after a rack to stack them in. Locked, nothing drags from it. */
function Palette() {
  const cat = useCatalog();
  const locked = useLocked();
  const why = locked ? 'Locked: unlock the lab (🔒) to add a chassis or a rack. ' : '';
  const groups = Object.groupBy(cat.chassis, (c) => c.category ?? 'Chassis');
  return (
    <footer className="palette">
      <section>
        <h4>Racks</h4>
        <div className="items">
          <div className={`item${locked ? ' off' : ''}`} draggable={!locked} title={`${why}A 19-inch rack. Drag it onto the canvas, then drag boxes into it: each shows its chassis front.`}
            onDragStart={(e) => e.dataTransfer.setData(RACK_MIME, 'rack')}>
            <RackIcon />
            Rack
            <small>19-inch</small>
          </div>
        </div>
      </section>
      {Object.entries(groups).map(([category, chassis]) => (
        <section key={category}>
          <h4>{category}</h4>
          <div className="items">
            {chassis?.map((c) => {
              // A tester by its ports (it comes with its module), a chassis by its slots.
              const ports = Object.values(c.comesWith ?? {}).reduce((n, lc) => n + (byId(cat.linecards, lc)?.ports.length ?? 0), 0);
              const size = c.tester ? `${ports} ports` : `${c.slots.length} slots`;
              return (
                <div key={c.id} className={`item${locked ? ' off' : ''}`} draggable={!locked} title={`${why}${c.about ?? size}. Drag onto the canvas.`}
                  onDragStart={(e) => e.dataTransfer.setData(CHASSIS_MIME, c.id)}>
                  <ChassisIcon tester={c.tester} />
                  {c.name}
                  <small>{size}</small>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </footer>
  );
}

/** Where the selected fiber runs, Tx to Rx. */
function Inspector() {
  const t = useStore((s) => s.topology);
  const link = useStore((s) => s.topology?.links.find((l) => l.id === s.selected));
  if (!t || !link) return null;
  return (
    <section className="panel">
      <h4>Fiber {link.id} · SMF{sameEnd(link.a, link.b) ? ' · loopback' : ''}</h4>
      <div>{path(t, link.a)} Tx → {path(t, link.b)} Rx</div>
      <button onClick={() => useStore.getState().deleteLink(link.id)}>Delete fiber</button>
    </section>
  );
}

/** Live re-validation, so problems in the lab are listed, with what a box has set outside the catalog. */
function Problems() {
  const t = useStore((s) => s.topology);
  const live = useStore((s) => s.live);
  const problems = useMemo(() => {
    if (!t) return [];
    const cat = catalogFor(t.stream);
    return [...validate(t, cat), ...t.devices.flatMap((d) => { const s = stateFor(live, d); return s ? l0Problems(t, cat, s, d) : []; })];
  }, [t, live]);
  if (!problems.length) return null;
  return (
    <section className="panel problems">
      <h4>{problems.length} problem{problems.length > 1 ? 's' : ''}</h4>
      <ul>{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
    </section>
  );
}

function Toast() {
  const toast = useStore((s) => s.toast);
  return toast ? <div className="toast" role="alert">{toast}</div> : null;
}

export function App() {
  useLab();
  const open = useStore((s) => !!s.topology);
  const openDevice = useStore((s) => s.openDevice);
  const session = useStore((s) => s.session);
  const readOnly = useStore((s) => s.readOnly);
  return (
    <div className="app">
      <TopBar />
      <main>
        {open ? <ReactFlowProvider key={session}><Canvas /></ReactFlowProvider> : <div className="empty-hint">{readOnly ?? 'Loading the lab from the bridge…'}</div>}
        <div className="overlay"><Inspector /><Problems /></div>
      </main>
      {open && <Palette />}
      {/* Mounted only while a device is open: closing it also closes the box's CLI session. */}
      {open && openDevice && <PhysicalView key={openDevice} />}
      {/* Over the canvas and the physical view; each its own shell, so closing the view leaves them open. */}
      <TermWindows />
      <Toast />
    </div>
  );
}
