import type { Box, FacePort, LinecardDef, PortBehavior, PortDef, Strand, View } from './types';

/**
 * Where a port's Tx and Rx are on its card's faceplate picture: the halves of its connector, OUT on the left as the
 * fronts print it, or where they sit apart. An output alone has just its Tx.
 */
export function strandsAt(f: FacePort): Partial<Record<Strand, Box>> {
  if (f.tx || f.rx) return { ...(f.tx && { tx: f.tx }), ...(f.rx && { rx: f.rx }) };
  if (!f.box) return {};
  const [x, y, w, h] = f.box;
  return { tx: [x, y, w / 2, h], rx: [x + w / 2, y, w / 2, h] };
}

/**
 * Is the port, or its `strand`, on the card's front: every one is on a card the deck does not draw; else only those
 * its faceplate has, the rest being inside the card (an amplifier's BAIN, the WSS's COM).
 */
export function onFront(card: LinecardDef | undefined, port: string, strand?: Strand) {
  const ports = card?.faceplate?.ports;
  if (!ports) return true;
  return !!ports[port] && (!strand || !!strandsAt(ports[port])[strand]);
}

export type PortTone = 'l1' | 'data' | 'aux';

const defaultsFor = (port?: PortDef): Required<PortBehavior> => {
  if (!port) return { showsInL1: false, showsInData: false, canLoopback: false, serviceGroup: 'default' };
  return {
    showsInL1: port.role === 'line',
    showsInData: port.role === 'client',
    canLoopback: port.role === 'line',
    serviceGroup: 'default',
  };
};

export const behaviorOf = (port?: PortDef): Required<PortBehavior> => ({ ...defaultsFor(port), ...port?.behavior });

export const showsInView = (view: View, port?: PortDef) =>
  view === 'L0' || (view === 'L1' ? behaviorOf(port).showsInL1 : behaviorOf(port).showsInData);

export const toneOf = (port?: PortDef): PortTone => {
  const behavior = behaviorOf(port);
  if (behavior.showsInL1) return 'l1';
  if (behavior.showsInData) return 'data';
  return 'aux';
};

export const canLoopback = (port?: PortDef) => behaviorOf(port).canLoopback;
export const roleOf = (port?: PortDef) => port?.role ?? 'port';
