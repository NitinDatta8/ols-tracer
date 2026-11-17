import RFB from '@novnc/novnc';
import { useEffect, useRef, useState } from 'react';

type State = 'connecting' | 'connected' | 'password' | 'closed';

/**
 * A BERT's own screen, live and driven from here: the VNC server on the BERT, which SmartAccess's Remote Screen shows,
 * in noVNC over the bridge's relay (bridge/vnc?host=). Shared, so everyone who has it open sees the same screen, and a
 * SmartAccess session on it stays open. The bridge relays only from a tester's IP as the lab file has it.
 */
export function Screen({ host }: { host: string }) {
  const at = useRef<HTMLDivElement>(null);
  const rfb = useRef<RFB>(null);
  const [state, setState] = useState<State>('connecting');
  const [why, setWhy] = useState('');
  const [password, setPassword] = useState('');
  const [tries, setTries] = useState(0); // Reconnect

  useEffect(() => {
    if (!host) return;
    setState('connecting');
    setWhy('');
    const r = (rfb.current = new RFB(at.current!, `${location.origin.replace(/^http/, 'ws')}${import.meta.env.BASE_URL}bridge/vnc?host=${encodeURIComponent(host)}`, { shared: true }));
    r.scaleViewport = true;
    let closed = false; // noVNC refuses to disconnect what is closed already
    r.addEventListener('disconnect', () => { closed = true; });
    // Only this connection's events: one closed by a Reconnect or a new IP says nothing.
    const on = (type: string, f: (e: CustomEvent) => void) => r.addEventListener(type, (e) => rfb.current === r && f(e as CustomEvent));
    on('connect', () => setState('connected'));
    on('credentialsrequired', () => setState('password'));
    on('securityfailure', (e) => setWhy(e.detail.reason || 'The BERT refused the password'));
    on('disconnect', () => setState('closed'));
    return () => { rfb.current = null; if (!closed) r.disconnect(); };
  }, [host, tries]);

  const note = !host ? 'No BERT IP: unlock the lab (🔒) and enter it above'
    : state === 'connecting' ? `Connecting to the BERT's screen at ${host}…`
    : state === 'closed' ? why || `The BERT's screen at ${host} closed, or the bridge could not reach it` : '';
  return (
    <div className="bert-screen">
      <div ref={at} className="vnc" />
      {(state !== 'connected' || !host) && (
        <div className="note">
          {state === 'password' && host ? (
            <form onSubmit={(e) => { e.preventDefault(); rfb.current?.sendCredentials({ password }); setState('connecting'); }}>
              <span>The BERT's screen asks for its VNC password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="VNC password" autoFocus />
              <button>Send</button>
            </form>
          ) : <span>{note}</span>}
          {state === 'closed' && host && <button onClick={() => setTries((n) => n + 1)}>Reconnect</button>}
        </div>
      )}
    </div>
  );
}
