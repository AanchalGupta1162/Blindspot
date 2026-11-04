export async function register() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureMigrated } = await import("./lib/db/migrate");
    await ensureMigrated();
  }
}
