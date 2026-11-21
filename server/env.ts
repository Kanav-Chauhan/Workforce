// Environment variables per agent (Settings → Environment). One file per agent in ~/.workforce/env,
// owner-only (600), sourced into the agent's tmux session when it starts. The dashboard only ever
// sees the names; agents are told the names, never the values.

import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ensureDir, envFile } from "./paths.ts";

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
/** Names the agent's session needs as they are. */
const RESERVED = /^(PATH|HOME|USER|SHELL|TERM|TMUX|TMUX_PANE|PWD|LANG|LC_.*|CLAUDE.*|WORKFORCE.*)$/i;

export function checkEnvName(name: string): string {
  const n = name.trim();
  if (!NAME.test(n)) throw new Error("Use letters, digits and _ for the name, starting with a letter (like STRIPE_SECRET_KEY)");
  if (RESERVED.test(n)) throw new Error(`${n} is used by the system; pick another name`);
  return n;
}

/** Shell-safe single quoting: the file is read with `.` by sh. */
const quote = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;

export function formatEnv(vars: Record<string, string>): string {
  return Object.keys(vars)
    .sort()
    .map((k) => `export ${k}=${quote(vars[k]!)}\n`)
    .join("");
}

/** Reads what formatEnv wrote (and nothing cleverer). */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /^export ([A-Za-z_][A-Za-z0-9_]*)='((?:[^']|'\\'')*)'$/gm;
  for (const m of text.matchAll(re)) out[m[1]!] = m[2]!.replace(/'\\''/g, "'");
  return out;
}

export function readEnv(agentId: string): Record<string, string> {
  const f = envFile(agentId);
  return existsSync(f) ? parseEnv(readFileSync(f, "utf8")) : {};
}

export function envNames(agentId: string): string[] {
  return Object.keys(readEnv(agentId)).sort();
}

function writeEnv(agentId: string, vars: Record<string, string>) {
  const f = envFile(agentId);
  ensureDir(dirname(f));
  writeFileSync(f, formatEnv(vars), { mode: 0o600 });
  chmodSync(f, 0o600);
}

export function setEnv(agentId: string, name: string, value: string) {
  const n = checkEnvName(name);
  if (value.length > 16_000) throw new Error("That value is too long");
  if (/[\0]/.test(value)) throw new Error("The value has a character that can't be stored");
  writeEnv(agentId, { ...readEnv(agentId), [n]: value });
}

export function unsetEnv(agentId: string, name: string) {
  const vars = readEnv(agentId);
  delete vars[name];
  writeEnv(agentId, vars);
}

export function removeEnvFile(agentId: string) {
  rmSync(envFile(agentId), { force: true });
}

/** The env file to source before starting the agent, if it has anything. */
export function envFileFor(agentId: string): string | null {
  const f = envFile(agentId);
  return existsSync(f) && envNames(agentId).length ? f : null;
}
