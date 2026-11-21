import { describe, expect, it } from "vitest";
import { KEY_BAR, planKey, SOFT_NEWLINE, type KeyInfo } from "./keys";

const k = (key: string, mods: Partial<KeyInfo> = {}, type = "keydown"): KeyInfo => ({ type, key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });

describe("terminal keys", () => {
  it("Ctrl+C copies a selection, otherwise interrupts", () => {
    expect(planKey(k("c", { ctrlKey: true }), true)).toBe("browser");
    expect(planKey(k("c", { ctrlKey: true }), false)).toBe("terminal");
  });
  it("Ctrl+V and Ctrl+Shift+C/V use the clipboard", () => {
    expect(planKey(k("v", { ctrlKey: true }), false)).toBe("browser");
    expect(planKey(k("C", { ctrlKey: true, shiftKey: true }), false)).toBe("browser");
    expect(planKey(k("V", { ctrlKey: true, shiftKey: true }), false)).toBe("browser");
    expect(planKey(k("v", { metaKey: true }), false)).toBe("browser");
  });
  it("Shift+Enter sends a newline without submitting, once", () => {
    expect(planKey(k("Enter", { shiftKey: true }), false)).toEqual({ send: SOFT_NEWLINE });
    expect(planKey(k("Enter", { shiftKey: true }, "keypress"), false)).toBe("swallow");
    expect(planKey(k("Enter"), false)).toBe("terminal");
  });
  it("leaves ordinary keys to the terminal", () => {
    expect(planKey(k("a"), false)).toBe("terminal");
    expect(planKey(k("d", { ctrlKey: true }), false)).toBe("terminal");
  });
  it("key bar has the keys phones lack", () => {
    expect(Object.fromEntries(KEY_BAR.map((b) => [b.label, b.bytes]))).toEqual({ Esc: "\x1b", Tab: "\t", "↑": "\x1b[A", "↓": "\x1b[B", "Ctrl+C": "\x03", Enter: "\r" });
  });
});
