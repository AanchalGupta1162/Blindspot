import { expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireDatabaseLease } from "../lib/db/lease";
it("prevents two PGlite owners from opening the same data directory", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "db-lease-")), "pg");
  const release = acquireDatabaseLease(dir);
  expect(() => acquireDatabaseLease(dir)).toThrow(/already open/);
  release();
  const second = acquireDatabaseLease(dir);
  second();
});

import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
it("refuses concurrent starts against a stale lease rather than deleting a new owner's lock", async () => {
  const dir = join(mkdtempSync(join(tmpdir(), "stale-db-lease-")), "pg");
  writeFileSync(`${dir}.blindspot-lock`, JSON.stringify({ pid: 2147483647 }));
  const code = `import {acquireDatabaseLease} from './lib/db/lease.ts';try{acquireDatabaseLease(process.argv[1]);}catch(e){process.exitCode=2;}`;
  const launch = () => new Promise<number | null>((resolve) => { const child = spawn(process.execPath,["--import","tsx","--input-type=module","-e",code,dir],{stdio:"pipe"});child.on("close",resolve); });
  expect(await Promise.all([launch(), launch()])).toEqual([2, 2]);
});
