import { describe, expect, it, vi } from "vitest";
import { withDatabaseReadRetry } from "../lib/db/read-retry";

describe("database read recovery", () => {
  it("retries a wrapped terminated connection and returns the new connection's result", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("query failed", { cause: Object.assign(new Error("terminated"), { code: "57P01" }) })).mockResolvedValue("session");
    expect(await withDatabaseReadRetry(read, 0)).toBe("session");
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("does not retry permissions, validation or arbitrary application errors", async () => {
    const error = Object.assign(new Error("denied"), { code: "42501" });
    const read = vi.fn().mockRejectedValue(error);
    await expect(withDatabaseReadRetry(read, 0)).rejects.toBe(error);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("stops after one retry rather than leaving the page waiting indefinitely", async () => {
    const error = Object.assign(new Error("reset"), { code: "ECONNRESET" });
    const read = vi.fn().mockRejectedValue(error);
    await expect(withDatabaseReadRetry(read, 0)).rejects.toBe(error);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
