// The CLI's tables, read by column name: shared by the bridge (wiring) and the app (src/l0.ts).

/** A table as this CLI prints it: each row of the block over a line of dashes, cut where the dashes are. */
function table(/** @type {string[]} */ lines, /** @type {number} */ dashes) {
  const starts = [...lines[dashes].matchAll(/-+/g)].map((m) => m.index);
  const cells = (/** @type {string} */ line) => starts.map((a, i) => line.slice(a, starts[i + 1]).trim());
  let head = dashes - 1;
  while (head > 0 && lines[head - 1].trim() && !lines[head - 1].startsWith('[')) head--;
  const names = cells(lines[head] ?? '');
  /** @type {Record<string, string>[]} */
  const rows = [];
  for (let i = dashes + 1; i < lines.length && lines[i].trim(); i++) {
    const row = cells(lines[i]);
    rows.push(Object.fromEntries(names.map((n, k) => [n, row[k]])));
  }
  return { key: names[0], rows };
}

/**
 * Every table in a command's output, a row keyed by its first column and merged across its [config] and [state] tables.
 * @param {string} raw
 * @returns {{ id: string, cols: Record<string, string> }[]}
 */
export function tables(raw) {
  const lines = raw.split('\n');
  /** @type {Map<string, Record<string, string>>} */
  const merged = new Map();
  lines.forEach((line, i) => {
    if (!/^-+(\s+-+)*\s*$/.test(line)) return;
    const { key, rows } = table(lines, i);
    for (const row of rows) merged.set(row[key], { ...merged.get(row[key]), ...row });
  });
  return [...merged].map(([id, cols]) => ({ id, cols }));
}
