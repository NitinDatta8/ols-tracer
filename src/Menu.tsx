import { useEffect, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from './store';
import type { TermItem } from './terminals';

/** A line of a right-click menu: `pick` when it can be picked, else `why` it is greyed out. */
export interface MenuItem { key: string; label: string; pick?: () => void; why?: string; title?: string }

type Open = { x: number; y: number; title: string; items: MenuItem[] };

/** Terminals as menu lines (see termItems): picking one opens its window. */
export const termLines = (items: TermItem[]): MenuItem[] => items.map((item) => ({
  key: item.kind, label: item.label, why: item.why, title: item.why ?? item.open?.steps.join(' → '),
  pick: item.open && (() => useStore.getState().openTerm(item.open!)),
}));

/**
 * A right-click menu at the pointer, of terminals (termLines) and procedures: picking a line does what it says. One that
 * can't be picked is greyed out with why under it. Esc, a click elsewhere, a scroll or leaving the page closes it.
 * Returns the handler for onContextMenu and the menu to render.
 */
export function useMenu() {
  const [menu, setMenu] = useState<Open | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    // Caught first, so Esc closes only the menu, not the level of the physical view under it.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('wheel', close, true);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('wheel', close, true);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  const open = (e: MouseEvent, { title, items }: { title: string; items: MenuItem[] }) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, title, items });
  };

  const element = menu && createPortal(
    <div className="menu" role="menu" style={{ left: Math.min(menu.x, innerWidth - 300), top: Math.min(menu.y, innerHeight - 40 - 46 * menu.items.length) }}
      // A portal's events still bubble up the React tree: a pick must not also click the device or card it was opened on.
      onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      <h5>{menu.title}</h5>
      {menu.items.map((item) => (
        <button key={item.key} role="menuitem" disabled={!item.pick} title={item.title ?? item.why}
          onClick={() => { item.pick?.(); setMenu(null); }}>
          {item.label}
          {item.why && <small>{item.why}</small>}
        </button>
      ))}
    </div>,
    document.body,
  );
  return [open, element] as const;
}
