// Which keys the browser terminal handles itself, and what the phone key bar sends.
// Pure, so it is unit-tested; the xterm wiring lives in components/Terminal.tsx.

export interface KeyInfo {
  type: string; // "keydown" | "keypress" | "keyup"
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/**
 * - "browser": let the browser do its default (copy/paste events, which xterm turns into
 *   clipboard copy of the selection or a paste into the terminal); xterm ignores the key.
 * - "terminal": xterm handles the key normally.
 * - { send }: we send these bytes ourselves and swallow the key.
 * - "swallow": nobody handles it (the matching keypress/keyup of a key we already sent).
 */
export type KeyPlan = "browser" | "terminal" | "swallow" | { send: string };

/** ESC + carriage return: Claude Code reads it as "new line" rather than "submit". */
export const SOFT_NEWLINE = "\x1b\r";

export function planKey(k: KeyInfo, hasSelection: boolean): KeyPlan {
  const letter = k.key.length === 1 ? k.key.toLowerCase() : "";
  const down = k.type === "keydown";

  if (k.key === "Enter" && k.shiftKey && !k.ctrlKey && !k.altKey && !k.metaKey) return down ? { send: SOFT_NEWLINE } : "swallow";

  // Mac: Cmd+C / Cmd+V are always the clipboard.
  if (k.metaKey && !k.ctrlKey && (letter === "c" || letter === "v")) return "browser";

  if (k.ctrlKey && !k.altKey && !k.metaKey) {
    // Ctrl+Shift+C / Ctrl+Shift+V: clipboard, like desktop terminals.
    if (k.shiftKey && (letter === "c" || letter === "v")) return "browser";
    // Ctrl+V pastes. Ctrl+C copies when something is selected, else it interrupts (terminal).
    if (!k.shiftKey && letter === "v") return "browser";
    if (!k.shiftKey && letter === "c" && hasSelection) return "browser";
  }
  return "terminal";
}

/** The phone key bar: keys phone keyboards don't have. */
export const KEY_BAR: { label: string; title: string; bytes: string }[] = [
  { label: "Esc", title: "Escape", bytes: "\x1b" },
  { label: "Tab", title: "Tab", bytes: "\t" },
  { label: "↑", title: "Up arrow", bytes: "\x1b[A" },
  { label: "↓", title: "Down arrow", bytes: "\x1b[B" },
  { label: "Ctrl+C", title: "Interrupt", bytes: "\x03" },
  { label: "Enter", title: "Enter", bytes: "\r" },
];
