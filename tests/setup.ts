import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Never charge mock-model tests to the real development ledger.
process.env.BLINDSPOT_SPEND_FILE = join(mkdtempSync(join(tmpdir(), "blindspot-test-spend-")), "spend.json");
process.env.BLINDSPOT_SESSIONS_DIR = mkdtempSync(join(tmpdir(), "blindspot-test-sessions-"));
