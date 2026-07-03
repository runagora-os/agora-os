import type { ResourceKind } from "./types.js";

/**
 * Single source of truth for every tunable constant. Keep ALL magic numbers
 * here so parameter sweeps (finding the "living" range where the colony neither
 * instantly dies nor freezes into equilibrium) touch one file only.
 */
export interface SimConfig {
  seed: string;

  /** Ticks per cycle. A cycle = one chronicler dispatch + snapshot. */
  ticksPerCycle: number;

  // --- Survival (Phase 1) ---
  lifeTaxBase: number; // α per tick just to exist
  memoryUpkeep: number; // α per unit memory per tick (hoarding is costly)
  actionComputeCost: number; // compute burned per action taken
  thinkInferenceCost: number; // inference burned to make an LLM-backed decision
  deathGrace: number; // ticks at wallet<=0 before removal

  // --- Population seeding ---
  initialAgents: number;
  startingWallet: { min: number; max: number };
  startingCompute: { min: number; max: number };
  startingMemory: { min: number; max: number };
  startingInference: { min: number; max: number };
  tier1Fraction: number; // fraction of agents that are Tier 1 (LLM-capable)

  // --- Job market (Phase 1) ---
  /**
   * Jobs per tick = jobBaseCount + jobsPerAgent * alive. The base is a mostly
   * FIXED pool that creates a carrying capacity: aggregate income (jobs*reward)
   * can only support so many agents' life tax, so an over-populated colony dies
   * back toward equilibrium and then sustains marginal turnover (a survival
   * lottery). jobsPerAgent adds a weak population term so the capacity breathes
   * a little. Keep jobsPerAgent well below reward/tax to avoid runaway growth.
   */
  jobBaseCount: number;
  jobsPerAgent: number;
  jobsPerTick: { min: number; max: number }; // absolute bounds
  jobBaseReward: number;
  jobComputeCost: { min: number; max: number };
  jobTtl: number; // ticks before an unclaimed job expires

  // --- Resource supply (Phase 2) ---
  /**
   * Free subsistence compute handed to every living agent each tick (all
   * phases). Enough for roughly one job, so nobody is ever locked out of
   * earning — this prevents a poverty trap where an agent with no α can't buy
   * fuel, can't work, and dies. Ambition beyond subsistence (filling extra job
   * slots from memory capital) requires buying compute on the market.
   */
  subsistenceCompute: number;
  computeMintPerTick: number; // extra compute sold via the priced faucet (Phase 2+)
  memoryMintPerTick: number; // memory faucet liquidity
  inferenceMintPerTick: number; // inference faucet liquidity
  faucetMarkup: number; // faucet sell price = spot * this
  supplyEnabled: boolean;

  // --- Resource economic function (Phase 2) ---
  /**
   * memory is productive CAPITAL. It multiplies the reward an agent earns per
   * job: effectiveReward = reward * min(maxProductivityMult, 1 + memory *
   * memoryProductivity). Every agent still gets equal ACCESS to the job lottery
   * (one job per tick), so capital doesn't starve laborers of work — it makes
   * the capital-rich earn more per unit of work. That compounds (more α → more
   * memory → higher productivity), producing smooth wealth stratification and,
   * eventually, a capital (memory) monopoly — without an instant die-off.
   */
  memoryProductivity: number;
  maxProductivityMult: number;
  /** compute buffer a Tier-0 agent tries to maintain by buying fuel. */
  computeTargetBuffer: number;

  // --- Pricing (Phase 2) ---
  priceK: number; // price elasticity
  priceHistoryLen: number; // window for moving averages
  priceBounds: Record<ResourceKind, { min: number; max: number }>;
  initialPrices: Record<ResourceKind, number>;

  // --- Credit (Phase 3) ---
  creditEnabled: boolean;
  loanRate: number; // per-tick interest
  loanTerm: number; // ticks until soft due
  maxLoanToWallet: number; // borrow up to this multiple of wallet

  // --- Anti-equilibrium guards ---
  minJobFloor: number; // never let open jobs drop below this many
  shockEnabled: boolean;
  shockEveryTicks: number; // periodic shock cadence (0 = off)
  shockMagnitude: number; // relative size of a shock

  // --- Phase gating: which mechanics are live ---
  phase: 1 | 2 | 3;
}

export const DEFAULT_CONFIG: SimConfig = {
  seed: process.env.SIM_SEED ?? "agora-genesis",
  ticksPerCycle: 60,

  lifeTaxBase: 1,
  memoryUpkeep: 0.05,
  actionComputeCost: 1,
  thinkInferenceCost: 1,
  deathGrace: 3,

  initialAgents: 50,
  startingWallet: { min: 20, max: 60 },
  startingCompute: { min: 5, max: 20 },
  startingMemory: { min: 0, max: 5 },
  startingInference: { min: 0, max: 5 },
  tier1Fraction: 0.0, // start Tier-0 only to prove emergence

  jobBaseCount: 8,
  jobsPerAgent: 0.06,
  jobsPerTick: { min: 3, max: 40 },
  jobBaseReward: 3,
  jobComputeCost: { min: 1, max: 3 },
  jobTtl: 5,

  subsistenceCompute: 3,
  computeMintPerTick: 30,
  memoryMintPerTick: 8,
  inferenceMintPerTick: 3,
  faucetMarkup: 0.9,
  supplyEnabled: false,

  memoryProductivity: 0.03,
  maxProductivityMult: 3,
  computeTargetBuffer: 8,

  priceK: 0.15,
  priceHistoryLen: 20,
  priceBounds: {
    compute: { min: 0.25, max: 20 },
    memory: { min: 0.5, max: 15 },
    inference: { min: 1, max: 60 },
  },
  initialPrices: {
    compute: 1,
    memory: 4,
    inference: 5,
  },

  creditEnabled: false,
  loanRate: 0.01,
  loanTerm: 30,
  maxLoanToWallet: 1.5,

  minJobFloor: 4,
  shockEnabled: true,
  shockEveryTicks: 120,
  shockMagnitude: 0.3,

  phase: 1,
};

/** Build a config for a given phase, enabling mechanics progressively. */
export function configForPhase(phase: 1 | 2 | 3, overrides: Partial<SimConfig> = {}): SimConfig {
  const base: SimConfig = { ...DEFAULT_CONFIG, phase };
  if (phase >= 2) {
    base.supplyEnabled = true;
    base.tier1Fraction = 0.0;
  }
  if (phase >= 3) {
    base.creditEnabled = true;
    base.tier1Fraction = 0.1;
    base.shockEnabled = true;
    base.shockEveryTicks = 180;
  }
  return { ...base, ...overrides };
}
