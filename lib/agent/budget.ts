import { closeSync, openSync, unlinkSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { Usage, costUsd, worstCaseCallUsd } from "./pricing";

export class BudgetExceeded extends Error {
  constructor(public scope: "run" | "development", public spent: number, public cap: number) {
    super(`${scope} budget exceeded: $${spent.toFixed(4)} spent of $${cap.toFixed(2)} cap`);
  }
}

export class BudgetBusy extends Error {}

export interface BudgetOptions {
  runCapUsd?: number;
  devCapUsd?: number;
  spendFile?: string | null; // null = do not persist (tests)
}

/**
 * Hard dollar caps enforced in code. Checked BEFORE every call (worst-case cost of the next call
 * must fit) and updated after every call from the response's usage. The development total persists to disk.
 */
export class Budget {
  runSpent = 0;
  readonly runCap: number;
  readonly devCap: number;
  private devSpent: number;
  private file: string | null;
  calls = 0;
  inputTokens = 0;
  outputTokens = 0;
  reasoningTokens = 0;
  models = new Set<string>();

  constructor(o: BudgetOptions = {}) {
    this.runCap = o.runCapUsd ?? Number(process.env.RUN_BUDGET_USD ?? 1.5);
    this.devCap = o.devCapUsd ?? Number(process.env.DEV_BUDGET_USD ?? 60);
    if (![this.runCap, this.devCap].every((v) => Number.isFinite(v) && v >= 0)) throw new Error("Budget caps must be finite nonnegative numbers");
    this.file = o.spendFile === undefined ? (process.env.BLINDSPOT_SPEND_FILE ?? "data/.spend.json") : o.spendFile;
    this.devSpent = this.readDev();
  }

  private ledger(): { totalUsd: number; charges: string[]; reservations: Record<string, number> } {
    if (!this.file || !existsSync(this.file)) return { totalUsd: 0, charges: [], reservations: {} };
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8"));
      const charges = raw.charges ?? [];
      const reservations = raw.reservations ?? {};
      if (typeof raw.totalUsd !== "number" || !Number.isFinite(raw.totalUsd) || raw.totalUsd < 0 || !Array.isArray(charges) || !charges.every((v: unknown) => typeof v === "string") || !reservations || typeof reservations !== "object" || !Object.values(reservations).every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0)) throw new Error();
      return { totalUsd: raw.totalUsd, charges, reservations };
    } catch { throw new Error("Spend ledger is invalid; refusing paid calls until repaired"); }
  }
  private writeLedger(ledger: ReturnType<Budget["ledger"]>) {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify({ ...ledger, totalUsd: Number(ledger.totalUsd.toFixed(6)), updatedAt: new Date().toISOString() }));
    renameSync(`${this.file}.tmp`, this.file);
  }
  private readDev(): number {
    const ledger = this.ledger();
    return ledger.totalUsd + Object.values(ledger.reservations).reduce((a, v) => a + v, 0);
  }

  get developmentSpent() {
    return this.devSpent;
  }

  /** Throws if the worst case of the next call would cross either cap. */
  assertCanCall(model: string, inputTokensEstimate: number, maxOutputTokens: number) {
    this.devSpent = this.file ? this.readDev() : this.devSpent;
    const next = worstCaseCallUsd(model, inputTokensEstimate, maxOutputTokens);
    if (this.runSpent + next > this.runCap) throw new BudgetExceeded("run", this.runSpent + next, this.runCap);
    if (this.devSpent + next > this.devCap) throw new BudgetExceeded("development", this.devSpent + next, this.devCap);
  }

  /** Serialize check + request + charge across CLI and server processes sharing this ledger. */
  async call<T extends { model: string; usage: Usage; replayed?: boolean; chargeId?: string }>(model: string, inputTokens: number, maxOutput: number, complete: (chargeId: string) => Promise<T>, replayed = false, chargeId: string = randomUUID()): Promise<{ reply: T; cost: number }> {
    let fd: number | undefined;
    const lock = this.file ? `${this.file}.lock` : null;
    if (lock) {
      mkdirSync(dirname(lock), { recursive: true });
      const deadline = Date.now() + 10000;
      while (fd === undefined) {
        try { fd = openSync(lock, "wx", 0o600); writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: Date.now() })); }
        catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
          if (Date.now() >= deadline) throw new BudgetBusy("Another model call holds the spend lock. If its process stopped, check billing before removing the .spend.json.lock file.");
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    }
    try {
      if (!replayed) this.assertCanCall(model, inputTokens, maxOutput);
      if (!replayed && this.file) {
        const ledger = this.ledger();
        ledger.reservations[chargeId] = worstCaseCallUsd(model, inputTokens, maxOutput);
        this.writeLedger(ledger);
      }
      const reply = await complete(chargeId);
      const cost = this.record(reply.model || model, reply.usage, reply.replayed, reply.chargeId ?? (replayed ? undefined : chargeId));
      return { reply, cost };
    } finally {
      if (fd !== undefined && lock) { closeSync(fd); unlinkSync(lock); }
    }
  }

  record(model: string, usage: Usage, replayed = false, chargeId?: string): number {
    const c = costUsd(model, usage);
    this.runSpent += c;
    const ledger = this.ledger();
    const charge = chargeId ? !ledger.charges.includes(chargeId) : !replayed;
    if (charge) ledger.totalUsd += c;
    if (chargeId && charge) ledger.charges.push(chargeId);
    if (chargeId) delete ledger.reservations[chargeId];
    if (this.file) {
      this.writeLedger(ledger);
      this.devSpent = this.readDev();
    } else if (charge) this.devSpent += c;
    this.calls++;
    this.inputTokens += usage.prompt_tokens;
    this.outputTokens += usage.completion_tokens;
    this.reasoningTokens += usage.reasoning_tokens ?? 0;
    this.models.add(model);
    return c;
  }
}
