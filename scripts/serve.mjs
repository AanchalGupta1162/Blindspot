/** Local server wrapper: checkpoint/close embedded Postgres before process exit. */
import { createServer } from "node:http";
const dev = !process.argv.includes("--production");
process.env.NODE_ENV = dev ? "development" : "production";
const { default: next } = await import("next");
const port = Number(process.env.PORT ?? 3000);
let app;
const server = createServer((req, res) => app.getRequestHandler()(req, res));
app = next({ dev, hostname: "localhost", port, httpServer: server });
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => { console.error("Shutdown timed out; inspect the embedded database before restarting."); process.exit(1); }, 15000);
  timeout.unref();
  try {
    // Stop accepting work, then close the database cleanly so its WAL/checkpoint is durable.
    server.close();
    server.closeAllConnections();
    await globalThis.__blindspotDb?.close();
    await app.close();
    clearTimeout(timeout);
    process.exit(code);
  } catch (e) { console.error("Shutdown failed:", e.message); process.exit(1); }
}
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
try {
  await app.prepare();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "localhost", resolve); });
  console.log(`Blindspot ${dev ? "development" : "production"} ready at http://localhost:${port}`);
} catch (e) { console.error("Startup failed:", e.message); await stop(1); }
