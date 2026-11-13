// A line with its placeholders filled in: the right-click terminals' steps (src/terminals.ts) and the procedures' step
// lines (procedures.mjs, and the app's panel, src/procedures.ts), so all fill them alike; and the values a procedure's
// param takes, so the panel and the bridge take the same ones.

/** A param's value: one word of printable text, so it can never add a second command to a line. */
const WORD = /^[\x21-\x7e]{1,64}$/;

/**
 * Whether `v` is a value of param `spec`: one word, one of its `enum`'s values or matching its `pattern` whole.
 * @param {{ enum?: string[], pattern?: string }} spec
 * @param {unknown} v
 * @returns {v is string}
 */
export function fits(spec, v) {
  if (typeof v !== 'string' || !WORD.test(v)) return false;
  return spec.enum ? spec.enum.includes(v) : new RegExp(`^(?:${spec.pattern})$`).test(v);
}

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
