import { ReactFlowProvider } from '@xyflow/react';
import { useMemo, useState } from 'react';
import { CHASSIS_MIME, Canvas, ChassisIcon } from './Canvas';
import { byId, catalogFor, streams } from './catalog';
import { PhysicalView } from './PhysicalView';
import { path, sameEnd, validate } from './rules';
import { useCatalog, useStore } from './store';
import type { Topology, View } from './types';

const VIEWS: [View, string][] = [
  ['L0', 'Optical: every fiber and port'],
  ['L1', 'Line ports and line fibers only'],
  ['Data', 'Data ports, with dashed services between cards joined by L1 fibers'],
];

function save(t: Topology) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(t, null, 2)], { type: 'application/json' }));
  a.download = `${t.stream}.olst.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href));
}

function OpenButton() {
  return (
    <label className="button">
      Open
      <input type="file" accept=".json" hidden onChange={async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) useStore.getState().open(await file.text());
      }} />
    </label>
  );
}

function TopBar() {
  const t = useStore((s) => s.topology);
  const view = useStore((s) => s.view);
  const { load, setView } = useStore.getState();
  return (
    <header className="topbar">
      <strong>OLS Tracer</strong>
      {/* Each corporation has its own hardware, so switching starts a new topology. */}
      {t && (
        <select className="corp" value={t.stream} title="Corporation: the palette shows only its hardware"
          onChange={(e) => (!t.devices.length || confirm(`Switch to ${byId(streams, e.target.value)?.name}? This discards the current topology.`))
            && load({ version: 1, stream: e.target.value, devices: [], links: [] })}>
          {streams.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      <button onClick={() => (!t?.devices.length || confirm('Discard the current topology?')) && load(null)}>New</button>
      <OpenButton />
      <button disabled={!t} onClick={() => t && save(t)}>Save</button>
      <span className="spacer" />
      {t && VIEWS.map(([v, title]) => (
        <button key={v} className={v === view ? 'on' : ''} title={title} onClick={() => setView(v)}>{v}</button>
      ))}
    </header>
  );
}

function NewProject() {
  const [stream, setStream] = useState(streams[0]?.id ?? '');
  return (
    <div className="backdrop">
      <div className="dialog">
        <h3>New topology</h3>
        <p className="muted">Pick the corporation for this project. The palette shows only its hardware.</p>
        {streams.map((s) => (
          <label key={s.id} className="radio">
            <input type="radio" name="stream" checked={s.id === stream} onChange={() => setStream(s.id)} /> {s.name}
          </label>
        ))}
        <div className="row">
          <button className="primary" onClick={() => useStore.getState().load({ version: 1, stream, devices: [], links: [] })}>
            Create
          </button>
          <OpenButton />
        </div>
      </div>
    </div>
  );
}

/** Bottom-left device palette, grouped by category like Packet Tracer. */
function Palette() {
  const cat = useCatalog();
  const groups = Object.groupBy(cat.chassis, (c) => c.category ?? 'Chassis');
  return (
    <footer className="palette">
      {Object.entries(groups).map(([category, chassis]) => (
        <section key={category}>
          <h4>{category}</h4>
          <div className="items">
            {chassis?.map((c) => (
              <div key={c.id} className="item" draggable title={`${c.slots.length} slots. Drag onto the canvas.`}
                onDragStart={(e) => e.dataTransfer.setData(CHASSIS_MIME, c.id)}>
                <ChassisIcon />
                {c.name}
              </div>
            ))}
          </div>
        </section>
      ))}
      <section>
        <h4>Connections</h4>
        <div className="items">
          <div className="item static" title="Drag from a port's Tx to another port's Rx on the canvas (or click one, then the other). A fiber runs one way; a loopback-capable port can loop its Tx back to its own Rx. Select a fiber to drag its runs; double-click a run to route it automatically again.">
            <svg className="icon" width="48" height="30"><path d="M4 26 C 18 -4, 30 34, 44 4" /></svg>
            SMF Tx → Rx
          </div>
        </div>
      </section>
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

/** Live re-validation, so problems in an opened file are listed. */
function Problems() {
  const t = useStore((s) => s.topology);
  const problems = useMemo(() => (t ? validate(t, catalogFor(t.stream)) : []), [t]);
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
  const open = useStore((s) => !!s.topology);
  const openDevice = useStore((s) => s.openDevice);
  const session = useStore((s) => s.session);
  return (
    <div className="app">
      <TopBar />
      <main>
        {open && <ReactFlowProvider key={session}><Canvas /></ReactFlowProvider>}
        <div className="overlay"><Inspector /><Problems /></div>
      </main>
      {open && <Palette />}
      {/* Mounted only while a device is open: closing it also closes the box's CLI session. */}
      {open ? openDevice && <PhysicalView key={openDevice} /> : <NewProject />}
      <Toast />
    </div>
  );
}
