import type { SimConfig } from "./config.js";
import type { Rng } from "./rng.js";
import type {
  Agent,
  ColonyState,
  Disposition,
  MarketBook,
  ResourceKind,
} from "./types.js";
import { RESOURCE_KINDS } from "./types.js";

function makeDisposition(rng: Rng, tier: 0 | 1): Disposition {
  return {
    thrift: rng.float(),
    acquisitiveness: rng.float(),
    creditAppetite: rng.float(),
    tier,
  };
}

export function makeMarket(resource: ResourceKind, price: number): MarketBook {
  return {
    resource,
    price,
    priceHistory: [price],
    lastDemand: 0,
    lastSupply: 0,
    lastVolume: 0,
  };
}

/** Format an agent id like "a7f3" from a numeric counter (hex-ish, stable). */
export function formatAgentId(n: number): string {
  return "a" + (n * 2654435761 % 0xffff).toString(16).padStart(4, "0");
}

export function seedColony(config: SimConfig, rng: Rng): ColonyState {
  const markets = {} as Record<ResourceKind, MarketBook>;
  for (const r of RESOURCE_KINDS) {
    markets[r] = makeMarket(r, config.initialPrices[r]);
  }

  const state: ColonyState = {
    tick: 0,
    cycle: 0,
    agents: new Map<string, Agent>(),
    markets,
    jobs: [],
    debts: new Map(),
    reclaimed: { compute: 0, memory: 0, inference: 0 },
    nextIds: { agent: 0, job: 0, order: 0, debt: 0, event: 0 },
  };

  for (let i = 0; i < config.initialAgents; i++) {
    const id = formatAgentId(state.nextIds.agent++);
    const tier: 0 | 1 = rng.chance(config.tier1Fraction) ? 1 : 0;
    const agent: Agent = {
      id,
      wallet: rng.range(config.startingWallet.min, config.startingWallet.max),
      resources: {
        compute: rng.range(config.startingCompute.min, config.startingCompute.max),
        memory: rng.range(config.startingMemory.min, config.startingMemory.max),
        inference: rng.range(config.startingInference.min, config.startingInference.max),
      },
      debts: [],
      age: 0,
      alive: true,
      deathCountdown: config.deathGrace,
      disposition: makeDisposition(rng, tier),
      bornTick: 0,
    };
    state.agents.set(id, agent);
  }

  return state;
}
