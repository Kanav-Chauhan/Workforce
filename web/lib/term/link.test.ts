import { describe, expect, it } from "vitest";
import { readServerFrame } from "./link";

describe("terminal channel", () => {
  it("binary frames are output, text frames are notices", () => {
    const f = readServerFrame(new Uint8Array([104, 105]).buffer);
    expect(f && "output" in f && Array.from(f.output as Uint8Array)).toEqual([104, 105]);
    expect(readServerFrame('{"kind":"ended","text":"Ended"}')).toEqual({ notice: { kind: "ended", text: "Ended" } });
    expect(readServerFrame('{"kind":"ready"}')).toEqual({ notice: { kind: "ready", text: "" } });
    expect(readServerFrame('{"kind":"other"}')).toBeNull();
    expect(readServerFrame("garbage")).toBeNull();
  });
});
