/**
 * Limits that bound a loop run. The governor halts as soon as any limit is hit,
 * so the loop can never run away (too many iterations, too much spend, or a run
 * of failures with no progress).
 */
export interface GovernorConfig {
  /** Hard cap on the number of iterations. The run halts once this is reached. */
  maxIterations: number;
  /** Optional cap on cumulative spend in USD. Omit for no budget limit. */
  maxBudgetUsd?: number;
  /** Halt after this many failures in a row (a reset on any success). */
  maxConsecutiveFailures: number;
}

/** The outcome of one iteration, fed to {@link Governor.record}. */
export type IterationOutcome = "success" | "failure";

/** The governor's verdict: whether to halt, and (if so) why. */
export interface GovernorDecision {
  /** True when a limit has been hit and the loop should stop. */
  halt: boolean;
  /** A human-readable reason, present only when `halt` is true. */
  reason?: string;
}

/**
 * A pure, in-memory loop governor. It tracks iteration count, the current run
 * of consecutive failures, and cumulative spend, and decides whether the loop
 * may continue. Performs NO I/O — feed it outcomes via {@link record} and ask
 * {@link decide} for the verdict, so it is fully unit-testable.
 */
export class Governor {
  private iterations = 0;
  private consecutiveFailures = 0;
  private spentUsd = 0;

  constructor(private readonly config: GovernorConfig) {}

  /**
   * Record one completed iteration: bump the iteration count, add its spend
   * (default 0) to the cumulative total, and update the consecutive-failure
   * run (reset to 0 on success, incremented on failure).
   */
  record(outcome: IterationOutcome, costUsd = 0): void {
    this.iterations += 1;
    this.spentUsd += costUsd;
    this.consecutiveFailures = outcome === "failure" ? this.consecutiveFailures + 1 : 0;
  }

  /**
   * Decide whether the loop should halt given everything recorded so far.
   * Returns `{ halt: false }` while every limit is respected, otherwise
   * `{ halt: true, reason }` for the first limit breached (iteration cap,
   * then consecutive-failure cap, then budget).
   */
  decide(): GovernorDecision {
    if (this.iterations >= this.config.maxIterations) {
      return { halt: true, reason: `reached max iterations (${this.config.maxIterations})` };
    }
    if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      return {
        halt: true,
        reason: `reached max consecutive failures (${this.config.maxConsecutiveFailures})`,
      };
    }
    if (this.config.maxBudgetUsd !== undefined && this.spentUsd >= this.config.maxBudgetUsd) {
      return { halt: true, reason: `reached budget cap ($${this.config.maxBudgetUsd})` };
    }
    return { halt: false };
  }
}
