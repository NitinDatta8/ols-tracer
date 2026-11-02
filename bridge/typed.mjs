// Typed commands: reads back what someone ran in the UI's terminal, so the recorder can run it again on the poller's
// clean shell. The keystrokes alone don't say what ran: Tab completion, backspaces and ↑ history happen on the box. A
// headless copy of the terminal's screen (@xterm/headless), fed the same output, shows the line as the box left it.
import xterm from '@xterm/headless';

/** The prompt of the box's operational mode, admin@PAHO-GS2000-03>. Configure mode's ends in #, and is skipped. */
const PROMPT = /^[\w.-]+@[\w.-]+>\s*/;

/** The `show` command on a prompt line, or null: only at the operational prompt, and never a ? help or a | pipe. */
export function typedShow(line) {
  if (!PROMPT.test(line)) return null;
  const cmd = line.replace(PROMPT, '').trim().replace(/\s+/g, ' ');
  return /^show(\s|$)/.test(cmd) && !/[?|]/.test(cmd) ? cmd : null;
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
