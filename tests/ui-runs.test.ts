import { expect, it } from "vitest";
import { getRun } from "../lib/ui/runs";
it("loads model-version recording IDs containing dots while rejecting path traversal", () => {
  expect(getRun("eval-v2-muse-spark-1.3-loose_connection-3000-llm")?.source).toBe("llm");
  expect(getRun("../models/ridge")).toBeNull();
});
