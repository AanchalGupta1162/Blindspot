import { closeSync, mkdirSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** PGlite's on-disk database must have one process owner, including during builds. */
export function acquireDatabaseLease(dir: string): () => void {
  if (dir.startsWith("memory:")) return () => {};
  const file = `${resolve(dir)}.blindspot-lock`;
  mkdirSync(dirname(file), { recursive: true });
  let fd: number;
  try { fd = openSync(file, "wx", 0o600); }
  catch { throw new Error("Embedded database is already open, or a prior process stopped uncleanly. Do not remove its .blindspot-lock until you confirm that process has stopped."); }
  writeFileSync(fd, JSON.stringify({ pid: process.pid }));
  closeSync(fd);
  let released = false;
  return () => { if (!released) { released = true; unlinkSync(file); } };
}
