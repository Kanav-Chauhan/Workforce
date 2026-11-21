import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { Db } from "./db.ts";
import { buildHttp } from "./http.ts";
import { Backlog, readViewerFrame, roomName, TermRooms, type Pty, type Viewer } from "./terminals.ts";

function fakePty() {
  const made: { args: string[]; written: string[]; sizes: [number, number][]; killed: boolean; emit: (s: string) => void; exit: (c: number) => void }[] = [];
  const spawn = (_file: string, args: string[]) => {
    let onData = (_s: string) => {};
    let onExit = (_e: { exitCode: number }) => {};
    const rec = { args, written: [] as string[], sizes: [] as [number, number][], killed: false, emit: (s: string) => onData(s), exit: (c: number) => onExit({ exitCode: c }) };
    made.push(rec);
    const pty: Pty = {
      onData: (fn) => (onData = fn),
      onExit: (fn) => (onExit = fn),
      write: (s) => rec.written.push(s),
      resize: (c, r) => rec.sizes.push([c, r]),
      kill: () => (rec.killed = true),
    };
    return pty;
  };
  return { spawn, made };
}

const viewer = () => {
  const got: string[] = [];
  const notes: string[] = [];
  const v: Viewer = { output: (s) => got.push(s), notice: (m) => notes.push(m.text) };
  return { v, got, notes };
};

describe("terminal frames", () => {
  it("reads keys, sizes and renew; ignores junk", () => {
    expect(readViewerFrame('{"op":"keys","data":"ls\\r"}')).toEqual({ op: "keys", data: "ls\r" });
    expect(readViewerFrame('{"op":"size","cols":80,"rows":24}')).toEqual({ op: "size", cols: 80, rows: 24 });
    expect(readViewerFrame('{"op":"size","cols":5000,"rows":24}')).toBeNull();
    expect(readViewerFrame('{"op":"size","cols":"80","rows":2.5}')).toBeNull();
    expect(readViewerFrame('{"op":"renew"}')).toEqual({ op: "renew" });
    expect(readViewerFrame("not json")).toBeNull();
    expect(readViewerFrame('{"op":"exec","cmd":"rm"}')).toBeNull();
  });
  it("routes each kind of terminal to its own room", () => {
    expect(roomName("agent", "p.leo")).not.toBe(roomName("shell", "p.leo"));
    expect(roomName("shell", "p.leo")).not.toBe(roomName("shell", "p.aries"));
  });
  it("keeps only the newest output", () => {
    const b = new Backlog(10);
    b.add("abcdef");
    b.add("ghijkl");
    expect(b.text()).toBe("cdefghijkl");
  });
});

describe("terminal rooms", () => {
  const program = () => ({ file: "bash", args: ["-l"], cwd: "/tmp" });

  it("shares one pty between viewers and replays output to late joiners", async () => {
    const { spawn, made } = fakePty();
    const rooms = new TermRooms(spawn, 0);
    const a = viewer(), b = viewer();
    await rooms.join("shell:x", a.v, program);
    made[0]!.emit("hello ");
    await rooms.join("shell:x", b.v, program);
    made[0]!.emit("world");
    expect(made).toHaveLength(1);
    expect(a.got.join("")).toBe("hello world");
    expect(b.got.join("")).toBe("hello world");
    rooms.keys("shell:x", "ls\r");
    rooms.resize("shell:x", 90, 30);
    expect(made[0]!.written).toEqual(["ls\r"]);
    expect(made[0]!.sizes).toEqual([[90, 30]]);
  });

  it("closes the pty after the last viewer leaves", async () => {
    const { spawn, made } = fakePty();
    const rooms = new TermRooms(spawn, 0);
    const a = viewer(), b = viewer();
    await rooms.join("shell:x", a.v, program);
    await rooms.join("shell:x", b.v, program);
    rooms.leave("shell:x", a.v);
    await new Promise((r) => setTimeout(r, 5));
    expect(made[0]!.killed).toBe(false);
    rooms.leave("shell:x", b.v);
    await new Promise((r) => setTimeout(r, 5));
    expect(made[0]!.killed).toBe(true);
    expect(rooms.has("shell:x")).toBe(false);
  });

  it("New shell moves everyone to a fresh pty", async () => {
    const { spawn, made } = fakePty();
    const rooms = new TermRooms(spawn, 0);
    const a = viewer();
    await rooms.join("shell:x", a.v, program);
    made[0]!.exit(0);
    expect(a.notes).toEqual(["Ended"]);
    await rooms.renew("shell:x", program);
    made[1]!.emit("$ ");
    expect(made).toHaveLength(2);
    expect(a.got.at(-1)).toBe("$ ");
    expect(rooms.viewerCount("shell:x")).toBe(1);
  });
});

describe("/term", () => {
  it("says when live terminals are off, and refuses other sites", async () => {
    const http = buildHttp(createApp(new Db(":memory:")), { spawn: null, reason: "no pty here" });
    expect((await http.inject("/api/terminals")).json()).toEqual({ available: false, reason: "no pty here" });
    await http.ready();
    const ws = await http.injectWS("/term/agent/x", { headers: { origin: "https://evil.example", host: "127.0.0.1:3010" } });
    const code = await new Promise<number>((r) => ws.on("close", (c: number) => r(c)));
    expect(code).toBe(1008);
    await http.close();
  });
});
