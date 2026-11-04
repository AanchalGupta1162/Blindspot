import { expect, it } from "vitest";
import { LiveRequestEpoch } from "../lib/ui/live-request";
it("ignores a poll started before an approval even when its response arrives last", async () => {
  const requests = new LiveRequestEpoch();
  const oldPoll = requests.capture();
  requests.invalidate();
  const decision = requests.capture();
  await Promise.resolve();
  expect(requests.accepts(oldPoll)).toBe(false);
  expect(requests.accepts(decision)).toBe(true);
});
it("invalidates a previous run and its restoration request", () => {
  const requests = new LiveRequestEpoch();
  const previousRun = requests.capture();
  requests.invalidate();
  expect(requests.accepts(previousRun)).toBe(false);
});
