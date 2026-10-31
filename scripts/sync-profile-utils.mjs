export const slug = (text) => String(text ?? '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'unknown';

const KNOWN_LINECARDS = {
  TMUXC_25: { id: 'lc-c25', name: 'C25', width: 2 },
  TMUXC925: { id: 'lc-c925', name: 'C925', width: 2 },
  TMUXC1125: { id: 'lc-c1125', name: 'C1125', width: 2 },
  '400MXS': { id: 'lc-400mx', name: '400MX', width: 1 },
  '800MX': { id: 'lc-800mx', name: '800MX', width: 1 },
};

export const linecardKnown = (vendorType) => KNOWN_LINECARDS[vendorType];
export const linecardIdForVendorType = (vendorType) => linecardKnown(vendorType)?.id ?? `lc-${slug(vendorType)}`;
export const linecardNameForVendorType = (vendorType) => linecardKnown(vendorType)?.name ?? String(vendorType);
export const linecardWidthOverrideForVendorType = (vendorType) => linecardKnown(vendorType)?.width;

export const uniqueSortedNums = (arr) => [...new Set(arr.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);

/**
 * Many card profiles expose a reduced slot list (for example 6 entries in an 8-slot chassis) for wide modules.
 * This gives a good first-pass width estimate without hard-coding every vendor type.
 */
export function deriveWidthFromSlots(profileSlots, chassisLineSlots) {
  const slots = uniqueSortedNums(profileSlots ?? []);
  const lineSlots = uniqueSortedNums(chassisLineSlots ?? []);
  if (!slots.length || !lineSlots.length) return 1;
  return Math.max(1, Math.min(4, Math.ceil(lineSlots.length / slots.length)));
}

export function normalizeFormFactor(raw) {
  const text = String(raw ?? '').trim().toUpperCase();
  if (!text) return '';
  const compact = text.replace(/[^A-Z0-9]+/g, '');
  if (compact.includes('NONPLUGGABLE')) return 'NON_PLUGGABLE';
  if (compact.includes('OSFP')) return 'OSFP';
  if (compact.includes('QSFP') && compact.includes('DD')) return 'QSFPDD';
  if (compact.includes('QSFP')) return 'QSFP';
  if (compact.includes('SFP')) return 'SFP';
  if (compact.includes('CFP2')) return 'CFP2';
  if (compact.includes('CFP')) return 'CFP';
  return text.replace(/\s+/g, '_');
}

