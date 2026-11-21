// Starts Workforce: the server on 127.0.0.1, the courier sweep and the agent watcher.
// Stopping the server leaves agents running in tmux; the next start picks them up again.

import { createApp } from "./app.ts";
import { buildHttp } from "./http.ts";
import { dbFile, port } from "./paths.ts";
import { loadNodePty } from "./terminals.ts";
import { SOCKET } from "./tmux.ts";

const app = createApp();
const pty = await loadNodePty();
if (!pty.spawn) console.warn(`Live terminals are off (${pty.reason}); the dashboard shows snapshots instead.`);
const http = buildHttp(app, pty);

await http.listen({ host: "127.0.0.1", port: port() });
app.courier.startSweep();
app.runner.startWatching();
console.log(`Workforce running on http://127.0.0.1:${port()}  (data: ${dbFile()}, agents: tmux -L ${SOCKET} ls)`);

const quit = async () => {
  app.runner.stopWatching();
  app.courier.stopSweep();
  await http.close();
  console.log("Workforce stopped. Agents keep running in tmux.");
  process.exit(0);
};
process.on("SIGINT", () => void quit());
process.on("SIGTERM", () => void quit());
