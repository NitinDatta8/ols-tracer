// tables: the CLI's tables read by column name, as the bridge (wiring) and the app (l0.ts) read them.
import { describe, expect, it } from 'vitest';
import { tables } from '../../bridge/tables.mjs';

describe('tables', () => {
  it('has none in output with no line of dashes', () => {
    for (const raw of ['', 'None\n', 'invalid command\n', 'name laser\n1-7-5 enabled\n']) expect(tables(raw), raw).toEqual([]);
  });

  it('reads each row under the dashes until a blank line, keyed by its first column, cut where the dashes are', () => {
    const raw = '[config]\n\nname     laser      frequency\n-----    -------    ---------\n1-7-5    enabled    193500000\n1-8-1    disabled   0\n\nafter the blank line\n';
    expect(tables(raw)).toEqual([
      { id: '1-7-5', cols: { name: '1-7-5', laser: 'enabled', frequency: '193500000' } },
      { id: '1-8-1', cols: { name: '1-8-1', laser: 'disabled', frequency: '0' } },
    ]);
  });

  it('names the columns by the first line of a header with units under it', () => {
    const raw = 'index    center-frequency    bandwidth\n         (MHz)               (MHz)\n-----    ----------------    ---------\n6        193500000           100000\n';
    expect(tables(raw)).toEqual([{ id: '6', cols: { index: '6', 'center-frequency': '193500000', bandwidth: '100000' } }]);
  });

  it("merges a row's [config] and [state] tables, and keeps a row only one of them has", () => {
    const raw = '[config]\nid    a\n--    -\nx     1\n\n[state]\nid    b\n--    -\nx     2\ny     3\n';
    expect(tables(raw)).toEqual([{ id: 'x', cols: { id: 'x', a: '1', b: '2' } }, { id: 'y', cols: { id: 'y', b: '3' } }]);
  });

  it('gives a short row its missing cells empty, the last column the rest of the line, and reads CRLF output', () => {
    expect(tables('id      a      b\n----    ---    ---\nx       1\ny\n')).toEqual([
      { id: 'x', cols: { id: 'x', a: '1', b: '' } }, { id: 'y', cols: { id: 'y', a: '', b: '' } },
    ]);
    expect(tables('id    value\n--    -----\nab    a value longer than its column\n')).toEqual([{ id: 'ab', cols: { id: 'ab', value: 'a value longer than its column' } }]);
    expect(tables('id    a\r\n--    -\r\nx     1\r\n')).toEqual([{ id: 'x', cols: { id: 'x', a: '1' } }]);
  });

  it('has no rows for a table with only its header', () => {
    expect(tables('id    a\n--    -\n')).toEqual([]);
    expect(tables('id    a\n--    -\n\nx     1\n')).toEqual([]);
  });
});
