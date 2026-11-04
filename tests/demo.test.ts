import { describe, expect, it } from "vitest";
import { demoEnabled, demoRequestAllowed } from "../lib/auth/demo";
describe("local demonstration login", () => {
  const env = { BLINDSPOT_DEMO_LOGIN: "true", BLINDSPOT_DEMO_PASSWORD: "test", BETTER_AUTH_URL: "http://localhost:3000" };
  it("requires explicit configuration and a local deployment", () => {
    expect(demoEnabled(env)).toBe(true);
    expect(demoEnabled({ ...env, BLINDSPOT_DEMO_LOGIN: "false" })).toBe(false);
    expect(demoEnabled({ ...env, BLINDSPOT_DEMO_PASSWORD: "" })).toBe(false);
    expect(demoEnabled({ ...env, VERCEL: "1" })).toBe(false);
    expect(demoEnabled({ ...env, BETTER_AUTH_URL: "https://example.com" })).toBe(false);
  });
  it("requires a same-origin localhost request", () => {
    expect(demoRequestAllowed(new Request("http://localhost:3000/api/auth/demo", { headers: { origin: "http://localhost:3000" } }))).toBe(true);
    expect(demoRequestAllowed(new Request("http://localhost:3000/api/auth/demo", { headers: { origin: "https://example.com" } }))).toBe(false);
    expect(demoRequestAllowed(new Request("https://example.com/api/auth/demo", { headers: { origin: "https://example.com" } }))).toBe(false);
  });
});
