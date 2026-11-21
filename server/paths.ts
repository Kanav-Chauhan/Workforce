// Where Workforce keeps its things. Override the home with WORKFORCE_HOME (tests use a temp folder).

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const home = () => process.env.WORKFORCE_HOME || join(homedir(), ".workforce");
export const dbFile = () => join(home(), "workforce.db");
export const projectDir = (projectId: string) => join(home(), "projects", projectId);
/** The agent's clone of the repo. */
export const agentDir = (projectId: string, sign: string) => join(projectDir(projectId), sign);
/** The agent's private files (role, settings, MCP config). Never inside the clone. */
export const agentPrivateDir = (projectId: string, sign: string) => join(projectDir(projectId), ".agents", sign);

export function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export const port = () => Number(process.env.WORKFORCE_PORT || 3010);
/** How agents reach the server. Always local. */
export const localUrl = () => `http://127.0.0.1:${port()}`;
