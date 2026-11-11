// Typed commands: reads back what someone ran in the UI's terminal, so the recorder can run it again on the poller's
// clean shell. The keystrokes alone don't say what ran: Tab completion, backspaces and ↑ history happen on the box. A
// headless copy of the terminal's screen (@xterm/headless), fed the same output, shows the line as the box left it.
import xterm from '@xterm/headless';

/** The prompt of the box's operational mode, admin@PAHO-GS2000-03>. Configure mode's ends in #, and is skipped. */
const PROMPT = /^[\w.-]+@[\w.-]+>\s*/;

/**
 * A command line that may run again on the box: { cmd }, its `show` command with its spaces evened out, or { why } not.
 * Only `show`, never a ? help, a | pipe or a ; & ` $ < >, on one line of printable text, so nothing else slips in. The
 * bridge's /show and the MCP's run_show hold a line to it too.
 */
export function showOf(line) {
  if (/[\x00-\x1f\x7f-\x9f]/.test(line)) return { why: 'a command is one line of printable text' };
  const cmd = line.trim().replace(/\s+/g, ' ');
  if (!/^show(\s|$)/.test(cmd)) return { why: `${cmd.split(' ')[0] || 'an empty line'} is not show: only show commands run on the box` };
  if (cmd.includes('|')) return { why: 'a | pipe could save to a file' };
  if (/[;&`$<>]/.test(cmd)) return { why: 'a ; & ` $ < or > could start another command, or write to a file' };
  if (cmd.includes('?')) return { why: 'a ? asks for help, not the box state' };
  return { cmd };
}

/** The `show` command on a prompt line, or null: only at the operational prompt, and only one showOf takes. */
export function typedShow(line) {
  return PROMPT.test(line) ? showOf(line.replace(PROMPT, '')).cmd ?? null : null;
}

/**
 * A headless copy of the terminal's screen. Call `enter()` when Enter is sent to the box: once the box has moved past
 * that line, `onShow` gets its `show` command, if it is one. The same size as the terminal, so long lines wrap alike.
 */
export class Screen {
  constructor({ cols, rows }, onShow) {
    this.term = new xterm.Terminal({ cols, rows, scrollback: 1000, allowProposedApi: true }); // its buffer is a proposed API
    this.onShow = onShow;
    this.pending = []; // markers on the lines Enter was pressed on
  }

  /** The box's output, as the terminal gets it. */
  write(d) { this.term.write(d, () => this.read()); }

  resize({ cols, rows }) { this.term.resize(cols, rows); }

  /** Enter was sent: marks the cursor's line, once the output so far is on the screen. */
  enter() {
    this.term.write('', () => {
      const m = this.term.registerMarker(0);
      if (m) this.pending.push(m);
    });
  }

  dispose() { this.term.dispose(); }

  /** Reads each marked line the box has moved past: the box echoes the Enter, so its cursor goes to a new line. */
  read() {
    const b = this.term.buffer.active;
    const cursor = b.baseY + b.cursorY;
    while (this.pending.length) {
      const m = this.pending[0];
      if (m.isDisposed) { this.pending.shift(); continue; } // scrolled out of the scrollback
      let start = m.line;
      while (start > 0 && b.getLine(start)?.isWrapped) start--;
      let end = start;
      while (b.getLine(end + 1)?.isWrapped) end++;
      if (cursor <= end) return; // still on it: the box hasn't echoed the Enter yet
      this.pending.shift();
      m.dispose();
      let line = '';
      for (let y = start; y <= end; y++) line += b.getLine(y)?.translateToString(y === end) ?? '';
      const cmd = typedShow(line);
      if (cmd) this.onShow(cmd);
    }
  }
}
