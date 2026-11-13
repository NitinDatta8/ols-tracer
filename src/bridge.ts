// The CLI bridge (bridge/server.mjs), which Vite proxies under /bridge: requests to it from this page, and who this page
// is to it.

/** This page, as the bridge tells who holds a session or asks for something: closing it leaves its sessions only. */
export const ME = `view:${crypto.randomUUID()}`;

/** The query naming the box's session, and this page as who joins or leaves it. */
export const sessionOf = (host: string) => `host=${encodeURIComponent(host)}&by=${encodeURIComponent(ME)}`;

/**
 * A request to the CLI bridge: a POST with `body` (or `method`, the lab's PUT), else a GET. The header tells the bridge it
 * comes from this app. Disconnect is sent with keepalive, so it still goes out when the page closes.
 */
export const bridge = (path: string, body?: string, method = body === undefined ? 'GET' : 'POST') => fetch(`${import.meta.env.BASE_URL}bridge/${path}`,
  { method, headers: { 'x-ols-tracer': '1' }, body, keepalive: path.startsWith('disconnect') });
