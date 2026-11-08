import { useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useStore } from './store';
import { BoxTerminal } from './Terminal';
import type { Term } from './terminals';

let top = 0; // the last window brought to the front

/**
 * A terminal window, over the canvas and the physical view: a new shell of its own on the box (the bridge's /shell),
 * with its steps typed in first, so it opens in show mode, telnetted into a card or in engineering mode. Drag it by its
 * title bar, resize it from its corner, click it to bring it to the front; ✕ closes it and its shell.
 */
function TermWindow({ term, index }: { term: Term; index: number }) {
  const [pos, setPos] = useState(() => ({ x: 120 + (index % 8) * 28, y: 90 + (index % 8) * 28 }));
  const [z, setZ] = useState(() => ++top);
  const src = useMemo(() => `bridge/shell?${new URLSearchParams({ host: term.host, steps: JSON.stringify(term.steps) })}`, [term]);

  const grab = (e: ReactPointerEvent) => {
    if ((e.target as Element).closest('button')) return;
    e.preventDefault();
    const [x0, y0, from, width] = [e.clientX, e.clientY, pos, e.currentTarget.parentElement?.offsetWidth ?? 0];
    // 80 px of the title bar stay on the page, so the window can always be dragged back.
    const move = (m: PointerEvent) => setPos({
      x: Math.min(Math.max(from.x + m.clientX - x0, 80 - width), innerWidth - 80),
      y: Math.min(Math.max(from.y + m.clientY - y0, 0), innerHeight - 32),
    });
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <section className="term-window" style={{ left: pos.x, top: pos.y, zIndex: z }} onPointerDown={() => z !== top && setZ(++top)}>
      <header onPointerDown={grab} title={term.steps.length ? `Typed in first: ${term.steps.join(' → ')}` : 'Show mode, where the session starts'}>
        <b>{term.title}</b>
        <button onClick={() => useStore.getState().closeTerm(term.id)} aria-label="Close terminal">✕</button>
      </header>
      <BoxTerminal live src={src} idle={`Opening a shell on ${term.host}…`} />
    </section>
  );
}

/** Every terminal window open; they are never saved. */
export function TermWindows() {
  const terms = useStore((s) => s.terms);
  return <div className="term-windows">{terms.map((t, i) => <TermWindow key={t.id} term={t} index={i} />)}</div>;
}
