import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';

/** Types into the box's CLI from outside the terminal, e.g. a Run button's command. */
export type Keys = { type: (keys: string) => void };

/**
 * The box's CLI as a real terminal (xterm.js) on the CLI bridge's SSH session (bridge/server.mjs). Keystrokes go to the
 * box as they are typed, so its own Tab completion, history (↑), Ctrl-C, ? help and modes work as they do over ssh.
 * Attached while `live`, each time showing the session from its start. `src` is the bridge's WebSocket:
 * `bridge/term?host=…`, the shell of the physical view's session with that box, or `bridge/shell?…`, a terminal
 * window's own shell; `idle` shows until it attaches.
 */
export function BoxTerminal({ live, ref, src, idle = 'Connect to the box to get its CLI here.' }: { live: boolean; ref?: Ref<Keys>; src: string; idle?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal>(null);
  const ws = useRef<WebSocket>(null);
  const send = (msg: object) => ws.current?.readyState === WebSocket.OPEN && ws.current.send(JSON.stringify(msg));

  useImperativeHandle(ref, () => ({ type: (d) => { send({ d }); term.current?.focus(); } }));

  // The terminal, fitted to its area.
  useEffect(() => {
    const t = (term.current = new Terminal({
      fontFamily: getComputedStyle(host.current!).getPropertyValue('--mono'), fontSize: 12, scrollback: 5000,
      theme: { background: '#0d1117', foreground: '#c9d1d9' },
    }));
    const fit = new FitAddon();
    t.loadAddon(fit);
    t.open(host.current!);
    t.write(`\x1b[90m${idle}\x1b[0m`);
    t.onData((d) => send({ d }));
    t.onResize(({ cols, rows }) => send({ cols, rows }));
    const resize = new ResizeObserver(() => fit.fit());
    resize.observe(host.current!);
    return () => { resize.disconnect(); t.dispose(); };
  }, []);

  // Attached to the session while the box is connected. The bridge closing it says so, in the terminal.
  useEffect(() => {
    if (!live) return;
    let gone = false;
    const s = (ws.current = new WebSocket(`${location.origin.replace(/^http/, 'ws')}${import.meta.env.BASE_URL}${src}`));
    s.binaryType = 'arraybuffer';
    s.onopen = () => { term.current!.reset(); send({ cols: term.current!.cols, rows: term.current!.rows }); };
    s.onmessage = (e) => term.current!.write(new Uint8Array(e.data));
    s.onclose = () => { if (!gone) term.current?.write('\r\n\x1b[90m[terminal closed]\x1b[0m\r\n'); };
    return () => { gone = true; s.close(); };
  }, [live, src]);

  return <div ref={host} className="xterm-host" />;
}
