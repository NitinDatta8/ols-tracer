import type { PortBehavior, PortDef, View } from './types';

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
