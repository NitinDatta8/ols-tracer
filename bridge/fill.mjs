// A line with its placeholders filled in: the right-click terminals' steps (src/terminals.ts) and the procedures' step
// lines (procedures.mjs), so both fill them alike.

/**
 * `line` with each `{name}` filled in from `vars`, and `{name*4}` as the value times 4; null when a value is missing,
 * or not a number where it is multiplied.
 * @param {string} line
 * @param {Record<string, string | number | undefined>} vars
 * @returns {string | null}
 */
export function fillStep(line, vars) {
  let ok = true;
  const out = line.replace(/\{(\w+)(?:\*(\d+))?\}/g, (m, /** @type {string} */ k, /** @type {string | undefined} */ times) => {
    const v = vars[k];
    if (v === undefined || (times && !/^\d+$/.test(String(v)))) {
      ok = false;
      return m;
    }
    return String(times ? Number(v) * Number(times) : v);
  });
  return ok ? out : null;
}
