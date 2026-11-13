// A line with its placeholders filled in: the right-click terminals' steps (src/terminals.ts) and the procedures' step
// lines (procedures.mjs, and the app's panel, src/procedures.ts), so all fill them alike; the values a procedure's
// param takes, so the panel and the bridge take the same ones; and whether a line typed elsewhere is a step filled in,
// for the MCP's check_commands.

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

/**
 * Whether `line` is `step` filled in: its text as it is, and each placeholder one word its param takes (`fits`), or for
 * `{name*4}` a number that is such a value times 4. fillStep the other way round, so a line typed elsewhere counts as a
 * procedure's only when one of its steps could have typed it.
 * @param {string} step
 * @param {Record<string, { enum?: string[], pattern?: string }>} specs
 * @param {string} line
 * @returns {boolean}
 */
export function fillsStep(step, specs, line) {
  const parts = step.split(/\{(\w+)(?:\*(\d+))?\}/); // text, then a placeholder's name and times, then text, and so on
  const from = (/** @type {number} */ i, /** @type {number} */ at) => {
    if (!line.startsWith(parts[i], at)) return false;
    at += parts[i].length;
    if (i === parts.length - 1) return at === line.length;
    const [name, times] = [parts[i + 1], parts[i + 2]];
    if (!Object.hasOwn(specs, name)) return false;
    // The value ends somewhere in the word that starts here: try each end, as the text after it may start in the word.
    for (let end = at + 1; end <= line.length && !/\s/.test(line[end - 1]); end++) {
      const v = line.slice(at, end);
      const value = !times ? v : /^\d+$/.test(v) && Number(v) % Number(times) === 0 ? String(Number(v) / Number(times)) : null;
      if (value !== null && fits(specs[name], value) && from(i + 3, end)) return true;
    }
    return false;
  };
  return from(0, 0);
}
