import { useState, type ReactNode } from 'react';
import { fibers, type Band, type Fact, type Fiber, type Row, type Stage } from './l0';

// The card's optical diagram, as its datasheet draws it: ports down each end, the WSS, each amplifier a triangle
// pointing the way its light goes, a VOA ahead of an amplifier that has one. In the drawing's own units.
const W = 1700;
const [X0, X1] = [165, 1535]; // the first and the last stage's middle
const PITCH = 13; // between two ports
const GAP = 12; // between two ways through the card
const PAD = 14;
const HALF = { ports: 13, wss: 55, amp: 30 }; // from a stage's middle to where a fiber meets it
const VOA = 80; // a VOA's middle, ahead of its amplifier's

type Ports = Extract<Stage, { kind: 'ports' }>;
type Point = [number, number];
/** A stage's ports in their own order, lit or not, so a port stays where it is when its light comes or goes. */
const portsOf = (s: Ports) => [...s.cells, ...s.idle].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

interface Tip { title: string; facts: Fact[]; notes: string[] }

const fiberTip = (f: Fiber): Tip => ({
  title: f.name,
  facts: [
    { label: 'Light', value: f.dBm !== undefined ? `${f.dBm.toFixed(2)} dBm` : f.port ? (f.port.dark ? 'no light' : 'no reading') : 'none reported', heat: f.heat },
    ...(f.port?.flag ? [{ label: 'Flag', value: f.port.flag }] : []),
    { label: 'From', value: f.source },
  ],
  notes: [f.heat?.why, ...(f.port?.alarms ?? [])].filter((x): x is string => !!x),
});

const stageTip = (s: Exclude<Stage, Ports>): Tip => ({ title: s.kind === 'amp' ? s.id : `WSS ${s.id}`, facts: s.facts, notes: s.alarms });

/**
 * Inside an L0 card: its optical diagram, with light in each fiber the box reads light in. Hovering a fiber or a part
 * shows what the box reports there, coloured against the same thresholds as the pipes. Under it, a card with a channel
 * plan has its spectrum: the band the plan allows, each media channel through the card in it. Then what the box has set
 * outside the catalog.
 */
export function Inside({ rows, problems, spectrum }: { rows: Row[]; problems: string[]; spectrum?: { min: number; max: number; channels: Band[] } | null }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const hover = (t: Tip) => ({ onMouseEnter: () => setTip(t), onMouseLeave: () => setTip(null) });
  const heights = rows.map((r) => Math.max(72, ...r.stages.map((s) => (s.kind === 'ports' ? portsOf(s).length * PITCH : 0))));
  const tops = heights.map((_, i) => heights.slice(0, i).reduce((sum, h) => sum + h + GAP, PAD));

  const way = (row: Row, i: number): ReactNode[] => {
    const n = row.stages.length;
    const dir = row.back ? -1 : 1; // the way light goes along x
    const slot = (k: number) => (row.back ? n - 1 - k : k);
    const xc = (k: number) => X0 + slot(k) * (n > 1 ? (X1 - X0) / (n - 1) : 0);
    const yc = tops[i] + heights[i] / 2;
    const yOf = (s: Ports, id: string) => { const ids = portsOf(s).map((c) => c.id); return yc + (ids.indexOf(id) - (ids.length - 1) / 2) * PITCH; };
    /** Into the card from its ports: rightwards at the left end, leftwards at the right. */
    const inward = (k: number) => (slot(k) === 0 ? 1 : -1);

    const parts = row.stages.flatMap((stage, k): ReactNode[] => {
      const x = xc(k);
      if (stage.kind === 'ports') {
        return portsOf(stage).map((c) => (
          <g key={`${k}${c.id}`} className={`inside-port${c.dBm !== undefined ? ' lit' : ''}`}>
            <rect x={x - HALF.ports} y={yOf(stage, c.id) - 4} width={HALF.ports * 2} height={8} rx={1.5} />
            <text x={x - inward(k) * (HALF.ports + 7)} y={yOf(stage, c.id)} textAnchor={inward(k) > 0 ? 'end' : 'start'}>{c.id} {c.dir.toUpperCase()}</text>
          </g>
        ));
      }
      const part = (key: string, shape: ReactNode) => <g key={`${k}${key}`} className={`inside-part${stage.alarms.length ? ' alarmed' : ''}`} {...hover(stageTip(stage))}>{shape}</g>;
      if (stage.kind === 'wss') {
        return [part('wss', <><rect x={x - HALF.wss} y={tops[i]} width={HALF.wss * 2} height={heights[i]} rx={12} /><text x={x} y={yc} textAnchor="middle">WSS {stage.id}</text></>)];
      }
      const [base, nose, v] = [x - dir * HALF.amp, x + dir * HALF.amp, x - dir * VOA];
      return [
        part('amp', <><path d={`M${base} ${yc - 26}V${yc + 26}L${nose} ${yc}Z`} /><text x={x - dir * 10} y={yc} textAnchor="middle">{stage.id}</text></>),
        // A VOA as the diagram has it: a circle with an arrow through it.
        ...(stage.voa ? [part('voa', <><circle cx={v} cy={yc} r={10} /><path className="mark" d={`M${v - 12} ${yc + 12}L${v + 12} ${yc - 12}m-6 0h6v6`} /><text x={v} y={yc - 20} textAnchor="middle">VOA</text></>)] : []),
      ];
    });

    const lines = fibers(row).map((f) => {
      const [a, b] = [row.stages[f.from], row.stages[f.from + 1]];
      const voa = b.kind !== 'ports' && b.voa ? xc(f.from + 1) - dir * VOA : undefined;
      const yPort = a.kind === 'ports' && f.port ? yOf(a, f.port.id) : b.kind === 'ports' && f.port ? yOf(b, f.port.id) : yc;
      /** Where a fiber meets a stage: a port's own box, a WSS straight across from the port, an amplifier's middle. */
      const meet = (s: Stage, k: number, side: 1 | -1): Point => (s.kind === 'ports' ? [xc(k) + inward(k) * HALF.ports, yPort] : [xc(k) + side * dir * HALF[s.kind], s.kind === 'wss' ? yPort : yc]);
      const from: Point = f.leg && voa !== undefined ? [voa + dir * 10, yc] : meet(a, f.from, 1);
      const to: Point = !f.leg && voa !== undefined ? [voa - dir * 10, yc] : meet(b, f.from + 1, -1);
      const run = to[0] - from[0];
      const d = `M${from[0]} ${from[1]}H${from[0] + run * 0.3}L${from[0] + run * 0.7} ${to[1]}H${to[0] - dir * 6}`;
      return (
        <g key={`f${f.from}${f.port?.id ?? f.leg ?? ''}`} className={`inside-fiber${f.dBm !== undefined ? ' lit' : ''}${f.heat ? ` ${f.heat.level}` : ''}`} {...hover(fiberTip(f))}>
          <path className="glass" d={d} />
          {f.dBm !== undefined && <path className="light" d={d} />}
          <path className="head" d={`M${to[0]} ${to[1]}l${-dir * 8} -3.5v7Z`} />
          <path className="hit" d={d} />
        </g>
      );
    });
    return [...lines, ...parts];
  };

  return (
    <div className="inside">
      {rows.length ? (
        <svg className="inside-fig" viewBox={`0 0 ${W} ${tops[tops.length - 1] + heights[heights.length - 1] + PAD}`} role="img" aria-label="The card's optical diagram, with the light in its fibers">
          {rows.map((row, i) => <g key={i}>{way(row, i)}</g>)}
        </svg>
      ) : <p className="inside-problem">The catalog has no light path for this card.</p>}
      {spectrum && (() => {
        const x = (mhz: number) => X0 + ((mhz - spectrum.min) / (spectrum.max - spectrum.min)) * (X1 - X0);
        const thz = (mhz: number) => `${(mhz / 1e6).toFixed(2)} THz`;
        return (
          <svg className="inside-fig inside-spectrum" viewBox={`0 0 ${W} 44`} role="img" aria-label="The card's band and its media channels">
            <rect className="band" x={X0} y={8} width={X1 - X0} height={20} />
            <text x={X0 - 8} y={18} textAnchor="end">{thz(spectrum.min)}</text>
            <text x={X1 + 8} y={18} textAnchor="start">{thz(spectrum.max)}</text>
            {spectrum.channels.map((c) => (
              <g key={c.id} className={`channel${c.up ? '' : ' down'}`} {...hover({ title: `Media channel ${c.id}`, facts: c.facts, notes: [] })}>
                <rect x={x(c.min)} y={8} width={Math.max(2, x(c.max) - x(c.min))} height={20} />
                <text x={(x(c.min) + x(c.max)) / 2} y={38} textAnchor="middle">{c.id}</text>
              </g>
            ))}
            {!spectrum.channels.length && <text x={W / 2} y={18} textAnchor="middle">no media channels through this card</text>}
          </svg>
        );
      })()}
      <p className="inside-readout">
        {tip ? (
          <>
            <b>{tip.title}</b>
            {tip.facts.map((f) => <span key={f.label} className={f.heat?.level} title={f.heat?.why}><i>{f.label}</i> {f.value}</span>)}
            {tip.notes.map((note) => <em key={note}>{note}</em>)}
          </>
        ) : `Hover a fiber or a part${spectrum?.channels.length ? ', or a media channel,' : ''} for what the box reports there.`}
      </p>
      {problems.map((p) => <p key={p} className="inside-problem">{p}</p>)}
    </div>
  );
}
