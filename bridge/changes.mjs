// What a box's sync changes on a device of the lab: a card, a pluggable or a fiber in or out. The physical view (src/lab.ts)
// and the bridge's lab file (lab.mjs) both say it, so it has no Node in it.

const endOf = (e) => `${e.device}/${e.slot}/${e.port}`;

/** What changed on a device between `was` and `now` ({ slots, links }), one line each: a card, a pluggable or a fiber in or out. */
export function changes(was, now) {
  const out = [];
  for (const slot of new Set([...Object.keys(was.slots), ...Object.keys(now.slots)])) {
    const [a, b] = [was.slots[slot], now.slots[slot]];
    if (a?.linecard !== b?.linecard) {
      if (a) out.push(`slot ${slot}: ${a.linecard} out`);
      if (b) out.push(`slot ${slot}: ${b.linecard} in`);
      continue;
    }
    for (const port of new Set([...Object.keys(a.ports ?? {}), ...Object.keys(b.ports ?? {})])) {
      const [p, q] = [a.ports?.[port]?.pluggable, b.ports?.[port]?.pluggable];
      if (p !== q) out.push(...(p ? [`${slot}/${port}: ${p} out`] : []), ...(q ? [`${slot}/${port}: ${q} in`] : []));
    }
  }
  const fiber = (l) => `${l.id} ${endOf(l.a)} ${endOf(l.b)}`;
  const [x, y] = [new Set(was.links.map(fiber)), new Set(now.links.map(fiber))];
  out.push(...was.links.filter((l) => !y.has(fiber(l))).map((l) => `fiber ${l.id} out`), ...now.links.filter((l) => !x.has(fiber(l))).map((l) => `fiber ${l.id} in`));
  return out;
}
