// Catalog (per stream, read-only JSON in /catalog)

export type Role = 'line' | 'client' | 'adddrop' | 'com' | 'osc' | 'monitor' | 'port' | 'ampin' | 'ampout';

export interface PortBehavior {
  showsInL1?: boolean;
  showsInData?: boolean;
  canLoopback?: boolean;
  serviceGroup?: string;
}

export interface L0Range { min?: number; max?: number }

export interface L0AmplifierDef {
  id: string;
  type?: string;
  ingressPort?: string;
  egressPort?: string;
  lineRole?: 'ingress' | 'egress';
  targetGain?: number;
  gainRange?: L0Range;
  targetGainTilt?: number;
  targetGainTiltRange?: L0Range;
  targetOutputPower?: number;
  maxOutputPower?: number;
  ingressVoaAtten?: number;
  ingressVoaAttenRange?: L0Range;
  targetSpanLossOffset?: number;
  targetSpanLossOffsetRange?: L0Range;
}

export interface L0InternalPathDef { fromPort: string; toPort: string; via: string[] }

export interface L0ChannelMonitorMap {
  mapIndex?: number;
  provisionMode?: string;
  channelNumber?: number;
  channelSpacing?: string;
  bandLowerFrequency?: number;
  bandUpperFrequency?: number;
}

export interface L0ChannelPlan {
  frequencyRange?: L0Range;
  bandwidthRange?: L0Range;
  gridMHz?: number;
  supportedProvisionModes?: string[];
  supportedMapIndexes?: number[];
  monitorMaps?: L0ChannelMonitorMap[];
}

export type L0ThresholdValue = number | [number, number];
export type L0PortThresholdEnvelope = Record<string, L0ThresholdValue>;

export interface L0CardMetadata {
  internalPaths?: L0InternalPathDef[];
  amplifiers?: L0AmplifierDef[];
  opticalThresholdEnvelopes?: Record<string, L0PortThresholdEnvelope>;
  channelPlan?: L0ChannelPlan;
}

export interface Stream { id: string; name: string }

/**
 * Datasheet info, all optional, for the hover and detail views of any hardware.
 * `image` is a path under public/; `url` a link, or a file under public/ such as a PDF datasheet.
 */
export interface Datasheet { vendor?: string; part?: string; image?: string; url?: string; about?: string; specs?: Record<string, string> }

export interface ChassisDef extends Datasheet {
  id: string;
  name: string;
  category?: string;
  /** Slots are listed row by row, `columns` to a row (default: one row). */
  columns?: number;
  slots: { id: string; allowedLinecards: string[] }[];
  /** Bays at the back: power supplies PSU1…PSUn and fan trays FAN1…FANn (default none). */
  psus?: number;
  fans?: number;
  /** Management ports in a narrow strip at the left of the front and of the back; USB-C ones are drawn as such, the rest as RJ-45. */
  mgmtPorts?: { front?: string[]; back?: string[] };
}

/**
 * `role` is the physical kind (line, client, add/drop, COM, OSC, monitor, generic port).
 * `behavior` controls UI and rules: L1 visibility, Data visibility, loopback and service grouping.
 * `allowedPluggables` lists pluggable ids or whole form-factor families ("QSFP" = every QSFP speed).
 * An empty list means a fixed LC connector (SMF, no pluggable needed).
 */
export interface PortDef { id: string; role: Role; behavior?: PortBehavior; allowedPluggables: string[] }

/**
 * `width` is how many side-by-side slots the card takes (default 1); it sits in the leftmost one.
 * Ports are laid out row by row, `columns` to a row, in the chassis and card views alike (default: one row of up to
 * five per slot of width, else two rows, as in its 1U slot: an 800MX's ten ports five over five).
 */
export interface LinecardDef extends Datasheet {
  id: string;
  name: string;
  width?: number;
  columns?: number;
  ports: PortDef[];
  l0?: L0CardMetadata;
}

/** `formFactor` is the family (SFP, QSFP, OSFP); its variants differ by `speed`. `dco` marks digital coherent optics. */
export interface PluggableDef extends Datasheet {
  id: string;
  name: string;
  formFactor: string;
  speed: string;
  fiber: 'SMF' | 'MMF';
  dco?: boolean;
}

/** CLI command templates per level; `{chassis}`, `{slot}` and `{port}` are filled in. */
export type CliLevel = 'chassis' | 'card' | 'port' | 'pluggable';

/** A CLI mode, in order from where the session starts; `enter` is the command that goes into it from the one before. */
export interface CliMode { name: string; prompt?: string; enter?: string; about?: string }

export interface Catalog {
  chassis: ChassisDef[]; linecards: LinecardDef[]; pluggables: PluggableDef[];
  cli: Record<CliLevel, string> & { modes: CliMode[] };
}

// Topology (the saved .olst.json file)

export interface SlotState { linecard: string; ports: Record<string, { pluggable: string }> }

export interface Device {
  id: string;
  chassis: string;
  name: string;
  /** The chassis number in CLI commands (default 1). */
  chassisNo?: number;
  /** The box's IP (or name) the physical view connects to, to run CLI commands on it. */
  host?: string;
  x: number;
  y: number;
  slots: Record<string, SlotState>;
  /** Back bays left empty, e.g. ["PSU2"]; the others hold their PSU or fan. */
  emptyBays?: string[];
}

export interface End { device: string; slot: string; port: string }

/** A port's two LC connectors: a fiber leaves a Tx and lands on an Rx. */
export type Strand = 'tx' | 'rx';

/**
 * Simplex SMF from a's Tx to b's Rx. Each strand of a port has its own fiber, so a port's Tx and Rx may go to
 * different ports. a = b is a loopback (line ports only).
 * `routes` holds its corners per view ('canvas', 'chassis:<device>', 'card:<device>/<slot>') once the user
 * moves it there; elsewhere it is routed automatically.
 */
export interface Link { id: string; type: 'smf'; a: End; b: End; routes?: Record<string, { x: number; y: number }[]> }

export interface Topology { version: 1; stream: string; devices: Device[]; links: Link[] }

export type View = 'L0' | 'L1' | 'Data';

// Alarms (raised from the topology, never saved)

/** At a port (`slot` and `port`) or a back bay (`bay`). */
export interface Alarm { severity: 'critical' | 'major'; slot?: string; port?: string; bay?: string; text: string }
