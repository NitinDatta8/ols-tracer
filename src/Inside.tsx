import { Fragment } from 'react';
import { firstLoss, hopName, type Fact, type Hop, type PortCell, type Row, type Stage, type Verdict } from './l0';
import type { BoxState } from './live';

const tone = (v?: Verdict | null) => (v ? ` ${v.level}` : '');

/** A port's power one way, with the box's flag (M measured, C on add/drop ports), or that it is dark. */
const Port = ({ c }: { c: PortCell }) => (
  <div className={`inside-port${tone(c.heat)}${c.dark ? ' dark' : ''}`} title={[c.heat?.why, ...c.alarms].filter(Boolean).join('\n') || undefined}>
    <b>{c.id}</b> <small>{c.dir}</small>
    <span>{c.dBm !== undefined ? `${c.dBm.toFixed(2)} dBm` : c.dark ? 'no light' : 'no reading'}{c.flag ? ` · ${c.flag}` : ''}</span>
    {c.alarms.length > 0 && <small className="inside-alarm">{c.alarms.length} alarm{c.alarms.length > 1 ? 's' : ''}</small>}
  </div>
);

const Facts = ({ facts }: { facts: Fact[] }) => (
  <dl>
    {facts.map((f) => (
      <div key={f.label} className={tone(f.heat).trim() || undefined} title={f.heat?.why}><dt>{f.label}</dt><dd>{f.value}</dd></div>
    ))}
  </dl>
);

function StageBox({ stage }: { stage: Stage }) {
  if (stage.kind === 'ports') {
    return (
      <div className="inside-stage ports">
        {stage.cells.map((c) => <Port key={c.id} c={c} />)}
        {stage.idle.length > 0 && <small className="inside-idle" title={stage.idle.join(', ')}>{stage.idle.length} idle</small>}
      </div>
    );
  }
  return (
    <div className={`inside-stage ${stage.kind}${stage.alarms.length ? ' alarmed' : ''}`} title={stage.alarms.join('\n') || undefined}>
      <h5>{stage.kind === 'amp' ? `▷ ${stage.id}` : `WSS ${stage.id}`}</h5>
      <Facts facts={stage.facts} />
      {stage.alarms.length > 0 && <small className="inside-alarm">{stage.alarms.length} alarm{stage.alarms.length > 1 ? 's' : ''}</small>}
    </div>
  );
}

/**
 * Inside an L0 card: each way light goes through it, with what the box reports at each stage, the light paths through
 * it, and what the box has set outside the catalog. Coloured against the same thresholds as the pipes.
 */
export function Inside({ rows, paths, state, problems }: { rows: Row[]; paths: Hop[][]; state: BoxState | null; problems: string[] }) {
  return (
    <div className="inside">
      {paths.map((hops, i) => {
        const loss = state && firstLoss(state, hops);
        return (
          <p key={i} className="inside-path">
            {hops.map(hopName).join(' → ')}
            {loss && <b> · first loss: {hopName(loss.hop)}, {loss.alarm['alarm-abbreviate']}</b>}
          </p>
        );
      })}
      {rows.map((row, i) => (
        <div key={i} className={`inside-row${row.back ? ' back' : ''}`}>
          {row.stages.map((stage, k) => (
            <Fragment key={k}>
              {k > 0 && <span className="inside-arrow">{row.back ? '←' : '→'}</span>}
              <StageBox stage={stage} />
            </Fragment>
          ))}
        </div>
      ))}
      {!rows.length && <p className="inside-path">The catalog has no light path for this card.</p>}
      {problems.map((p) => <p key={p} className="inside-problem">{p}</p>)}
    </div>
  );
}
