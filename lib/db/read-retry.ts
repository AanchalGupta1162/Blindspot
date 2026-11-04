/** Retry a read once when Postgres drops a connection (for example during Neon restart).
 * Never wrap mutations or model calls: a disconnected write may already have committed.
 */
export async function withDatabaseReadRetry<T>(read: () => Promise<T>, delayMs = 150): Promise<T> {
  try { return await read(); }
  catch (error) {
    let cause: unknown = error;
    let transient = false;
    for (let depth = 0; depth < 8 && cause && typeof cause === "object"; depth++) {
      const e = cause as { code?: string; cause?: unknown };
      if (["57P01", "57P02", "57P03", "08000", "08003", "08006", "ECONNRESET", "ETIMEDOUT", "EPIPE"].includes(e.code ?? "")) transient = true;
      cause = e.cause;
    }
    if (!transient) throw error;
    await new Promise(resolve => setTimeout(resolve, delayMs));
    return read();
  }
}
