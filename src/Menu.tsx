import { useEffect, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from './store';
import type { TermItem } from './terminals';

type Open = { x: number; y: number; title: string; items: TermItem[] };

/**
 * A right-click menu of terminals (see termItems), at the pointer: picking one opens its window. One that can't open is
 * greyed out with why under it. Esc, a click elsewhere, a scroll or leaving the page closes it.
 * Returns the handler for onContextMenu and the menu to render.
 */
export function useTermMenu() {
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

  const open = (e: MouseEvent, { title, items }: { title: string; items: TermItem[] }) => {
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
        <button key={item.kind} role="menuitem" disabled={!item.open} title={item.why ?? item.open?.steps.join(' → ')}
          onClick={() => { if (item.open) useStore.getState().openTerm(item.open); setMenu(null); }}>
          {item.label}
          {item.why && <small>{item.why}</small>}
        </button>
      ))}
    </div>,
    document.body,
  );
  return [open, element] as const;
}
