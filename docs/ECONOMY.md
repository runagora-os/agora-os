# AGORA OS — Economic Model

## Philosophy

AGORA OS is an **emergent economy**, not a game. The distinction matters:

- In a game, the designer decides who wins and loses, sets narrative beats, and scripts drama.
- In AGORA OS, the designer writes **rules**. Drama is what happens when agents with competing interests all apply those rules simultaneously.

The rules are deliberately simple — eight stages of arithmetic per tick. The complexity comes from interaction effects: agents bidding against each other, prices responding to demand, debt amplifying both gains and losses. There is no special-casing, no "if GDP drops, fix it" code. The engine runs the same rules in boom and bust alike.

---

## Currency: α (alpha)

`α` is the colony's internal unit of account.

### Issuance (sources of new α)

| Source | Mechanism | Notes |
|---|---|---|
| Job rewards | Workers earn α when jobs are completed | Primary source; controlled by `jobBaseReward` |
| Loan issuance | Borrowers receive α when a loan is created | Credit expansion; risk of default |
| Faucet ask orders | The system posts compute/memory/inference for sale at `faucetMarkup × spot price` | α is paid by buyers; this is a minor source |

### Destruction (sinks of α)

| Sink | Mechanism | Notes |
|---|---|---|
| Life tax | Charged every tick per agent | Primary sink; `lifeTaxBase + memory × memoryUpkeep` |
| Resource purchases | Buyers pay α in market trades | α transfers between agents, not destroyed |
| Loan interest | Outstanding debt accrues interest | Transfers to creditors, not destroyed |

Because α is neither minted nor burned during resource trades (just transferred), the money supply is roughly determined by: `new jobs × reward - agent count × tax rate`. This creates a carrying capacity: the economy can only sustain a population where aggregate job income ≥ aggregate tax.

### Formula: carrying capacity

```
max_sustainable_population ≈ (jobBaseCount × jobBaseReward) / lifeTaxBase
```

At `jobBaseCount = 40, jobBaseReward = 3, lifeTaxBase = 0.5`:
```
max ≈ (40 × 3) / 0.5 = 240
```
But not all jobs are claimed (only one per willing worker per tick at minimum), and not all agents can always afford compute, so the realized equilibrium is lower. In practice, equilibrium settles around 70–80% of the mathematical maximum.

---

## Resources

Resources are **not currency** — they are inputs to production. They have prices expressed in α, but their economic function is distinct.

### compute

**Role:** Fuel. Consumed by every productive action.

**Supply:** The engine provides a free `subsistenceCompute` ration per agent per tick (enough for approximately one job). Additional compute is available on the open market (Phase 2+).

**Demand:** Agents need compute to claim jobs. Without compute, an agent cannot earn α.

**Strategic implications:**
- An agent with no α and no compute is in a "poverty trap" — can't buy fuel, can't work, dies. The subsistence ration prevents this.
- An agent who wants to claim multiple jobs per cycle must buy compute on the market, creating a market for compute.
- Agents with high `riskTolerance` dispositions will buy aggressively; agents with low risk tolerance will hoard subsistence rations.

### memory

**Role:** Capital. A durable good that multiplies labor income.

**Supply:** Minted via market faucet. Lost when agents die (reclaimed by the system; re-sold over time).

**Demand:** Agents buy memory when flush and acquisitive. They sell memory under distress.

**The productivity formula:**

```
effectiveReward = job.reward × min(maxProductivityMult, 1 + memory × memoryProductivity)
```

At default settings (`memoryProductivity = 0.03, maxProductivityMult = 3.0`):

| Memory held | Productivity multiplier | Effective reward on a 3α job |
|---|---|---|
| 0 | 1.00× | 3.0α |
| 10 | 1.30× | 3.9α |
| 30 | 1.90× | 5.7α |
| 67 | 3.00× (capped) | 9.0α |

**Economic effects:**
- Memory compounds: more α → buy memory → earn more → buy more memory.
- Memory upkeep costs α every tick (`memoryUpkeep = 0.01/unit`), so hoarding huge amounts without earning enough to cover upkeep is self-destructive.
- When agents die in distress, they typically sell memory first (the `decideTrades` function prioritizes distress liquidation), so memory flows to agents who can afford to hold it. This creates a **rentier class** — agents whose primary income is productivity multiplier, not just labor.

### inference

**Role:** Cognition. Consumed by Tier-1 agents to make LLM-backed strategic decisions.

**Supply:** Minted via market faucet. Small quantity per tick to maintain scarcity.

**Demand:** Only Tier-1 agents draw inference. Tier-0 agents may sell it.

**Economic effects:**
- Inference-rich agents can make better-calibrated strategic decisions (e.g., strategic monopoly accumulation in `tier1.ts`).
- Making "thinking" an economic cost ensures that cognitive advantage has a real price. A poor Tier-1 agent with no inference behaves like a Tier-0 agent.
- Tier-0 agents holding inference can sell it to Tier-1 agents, creating a market for cognition.

---

## The Job Market

### Job emission

Each tick, the engine creates `N` new job postings:

```
N = clamp(
  floor(jobBaseCount + jobsPerAgent × aliveCount),
  jobsPerTick.min,
  jobsPerTick.max
)
```

Jobs have:
- **reward**: sampled uniformly from `[jobBaseReward × 0.7, jobBaseReward × 1.3]`
- **computeCost**: sampled uniformly from `[jobComputeCost.min, jobComputeCost.max]`
- **ttl**: `config.jobTtl` ticks (jobs expire if unclaimed)

### Job clearing

The clearing algorithm is designed to be:
1. **Meritocratic on reward** — higher-reward jobs are matched first
2. **Fair on access** — workers are shuffled, so no agent reliably gets first pick
3. **Productive-capital-sensitive on yield** — memory multiplies what you earn, not whether you get a job

```
sort openJobs by reward DESC
shuffle workers (random order each tick)

for each job:
  for each worker (in shuffled order):
    if worker already assigned this tick: skip
    if worker.resources.compute < job.computeCost: skip
    assign job to worker
    effectiveReward = job.reward × productivity(worker)
    worker.wallet += effectiveReward
    worker.resources.compute -= job.computeCost
    break
```

This means:
- A rich agent (high memory) who gets assigned the same job as a poor agent earns more for the same work.
- A poor agent can still get a job — they just earn less per job than a rich agent would.
- No agent can hog multiple jobs in one tick (one assignment per worker per tick).

### Why carrying capacity emerges

With `N` jobs and a population of `P` agents, at most `min(N, P)` agents can earn income in a single tick. If `P > N`:
- Some agents earn nothing that tick.
- Life tax is charged to all `P` agents.
- The agents who earned nothing lose wallet.
- Over time, their wallets hit zero → death → population shrinks toward `N`.

This creates a stable equilibrium around `P ≈ N` (with some variance from the stochastic job distribution and agent-specific compute constraints).

---

## Resource Markets

### Order book mechanics

Each resource (`compute`, `memory`, `inference`) has its own continuous double-auction order book.

**Agents submit orders as intents:**
```
{ kind: "trade", side: "buy", resource: "memory", qty: 5, limitPrice: 4.2 }
{ kind: "trade", side: "sell", resource: "memory", qty: 3, limitPrice: 3.8 }
```

**Clearing:**
```
sort bids: highest price first
sort asks: lowest price first

while bids[0].price >= asks[0].price:
  matchQty = min(bids[0].qty, asks[0].qty)
  matchPrice = (bids[0].price + asks[0].price) / 2  // midpoint
  
  buyer.resources[resource] += matchQty
  buyer.wallet -= matchPrice × matchQty
  
  seller.resources[resource] -= matchQty
  seller.wallet += matchPrice × matchQty
  
  emit "resource_traded"
  update order quantities; remove fully-filled orders
```

### Price dynamics

After each clearing, the price is updated based on realized volume pressure:

```
netDemand = totalBidVolume - totalAskVolume
pressure = netDemand / max(totalAskVolume, 1)
newPrice = clamp(
  price × (1 + pressure × priceK),
  priceBounds[resource].min,
  priceBounds[resource].max
)
```

`priceK = 0.05` (default) means a 10% excess-demand spike moves the price ~0.5%. Prices are bounded to prevent hyperinflation or floor collapse.

### The faucet (system sell orders)

In Phase 2+, the engine posts sell orders at `faucetMarkup × currentPrice` (default: 5% above spot). This:
- Provides a price ceiling (agents won't pay more than faucet price for the primary supply)
- Creates a reliable supply that doesn't require other agents to sell
- Keeps the economy liquid even when all agents are hoarding

---

## Credit System (Phase 3)

### Loan mechanics

Tier-0 agents borrow when distressed (wallet < 2× survival cost, no existing debt). The borrowing decision uses a sigmoid of `creditAppetite`:

```
borrowProbability = 0.5 + agent.disposition.creditAppetite × 0.5
```

So even a low-appetite agent has a 50% chance to borrow if they're sufficiently distressed.

**Loan parameters (defaults):**
- Interest rate: 1.5% per tick (`loanRate = 0.015`)
- Term: 30 ticks (`loanTerm`)
- Maximum: 3× wallet at time of borrow (`maxLoanToWallet`)

**Interest accrual:**
```
each tick: debt.outstanding += debt.outstanding × loanRate
```

### Repayment policy

Agents with sufficient buffer repay aggressively:

```
buffer = survivalCost × 4
if wallet > buffer:
  targetDebt = largest outstanding debt
  repayAmount = min(outstanding, wallet - buffer)
```

This prioritizes reducing the debt with the highest outstanding balance (greedy repayment). A smarter agent (Tier-1) could optimize repayment order by interest rate.

### Default and contagion

When an agent dies with debt:
```
for each debt owed by dead agent:
  if creditor is identifiable:
    creditor.wallet -= debt.outstanding
    emit "loan_defaulted"
```

If creditors lose enough α, they may themselves fail to cover their life tax → deathCountdown decreases → contagion spreads. This is how credit crises cascade: a few defaults hit creditors who were themselves leveraged.

**Note on current implementation:** Phase 3 uses a single "bank" creditor model. Per-agent P2P lending (where specific wealthy agents lend to specific distressed agents) is planned for a future phase, which will make contagion visible at the individual-agent level.

---

## Emergent Structures

These are **detected and reported** — not scripted.

### Monopoly

```
detected when:
  one agent holds > 50% of all held units of any resource
  
reported as:
  "Monopoly: agent-0017 controls 68% of memory supply"
```

Monopolies form because memory compounds wealth, and wealth enables more memory purchase. Once an agent crosses ~40% market share, their productivity multiplier is high enough to outrun competition in every tick.

**Observed dynamics:** Monopolists rarely deliberately try to corner the market. They simply optimize survival → buy memory when flush → memory makes them more flush → repeat. Cornering is an emergent consequence, not a goal.

### Class stratification

```
detected when:
  Gini coefficient > 0.45
  
reported as:
  "Class stratification: Gini 0.51 — 3 agents hold 72% of total wealth"
```

The Gini coefficient is computed over all alive agents' wallets. It starts near 0 (everyone seeded with similar wealth) and rises as memory capital compounds for lucky early survivors.

### Credit crisis

```
detected when:
  defaultsThisCycle / outstandingDebtAtCycleStart > 0.15  (>15% of debt defaulted)
  
reported as:
  "Credit crisis: 23% of outstanding debt defaulted this cycle"
```

Credit crises typically follow a sequence:
1. Population growth → more borrowers → more outstanding debt
2. A shock or job market contraction reduces income
3. Over-leveraged agents can't meet life tax → death
4. Defaults hit creditors → cascading distress
5. Credit markets freeze (no new loans) → fewer agents can weather the next shock
6. Population contracts until leverage ratio is sustainable again

### Die-off

```
detected when:
  deathsThisCycle / populationAtCycleStart > 0.20  (>20% mortality)
```

Die-offs can be sudden (triggered by a shock) or gradual (sustained job market contraction). The reclaimed resource pool helps recovery: when agents die, their compute/memory/inference re-enters the market, giving survivors access to cheap capital.

---

## Anti-Equilibrium Guards

AGORA OS actively fights two failure modes:

### 1. Stasis (everyone survives indefinitely)

If the economy is too easy (every agent can always afford to live), nothing interesting happens. Countered by:
- **Carrying capacity** via `jobBaseCount` — a fixed upper limit on how many agents can earn simultaneously
- **Memory upkeep** — hoarding capital has a cost; agents who can't earn enough to cover it must liquidate
- **Periodic shocks** — random supply disruptions disrupt comfortable equilibria

### 2. Extinction (everyone dies)

If the economy is too hard, the simulation becomes a race to zero. Countered by:
- **Subsistence compute** — free ration prevents poverty traps
- **Reclaimed resources** — dead agents' resources re-enter the market, helping survivors
- **Debt as lifeline** — agents can borrow their way through short-term crises

The parameter tuning goal is an economy that:
- Sustains 60–80% of the initial population in the long run
- Has continuous turnover (some agents die, new ones could spawn)
- Exhibits rising Gini over the first 200 ticks (stratification) that then plateaus
- Produces 1–3 structure detections per cycle

---

## Shocks

Every `shockEveryTicks` ticks (if `shockEnabled`), the engine applies a supply disruption:

```
shock magnitude: config.shockMagnitude (default 0.3)

for each resource:
  reduce available supply by (30% × randomFactor)
  spike prices by (shock × price × randomFactor)
  emit "shock"
```

Shocks test the resilience of the current economic structure. A highly stratified economy weathers shocks better (rich agents absorb the supply reduction); a highly leveraged economy is devastated (distressed borrowers can't sustain the extra pressure).

---

## Money Supply Dynamics

The money supply can be observed at any time:

```
moneySupply = Σ(agent.wallet) for all alive agents
```

It grows when:
- More jobs are completed than taxes are charged (net income positive)
- New loans are issued (credit expansion)

It shrinks when:
- Death removes agents (and their wallets) from the total
- Loan interest exceeds new loan issuance (credit contraction)

Long-term, the money supply oscillates around a level determined by `(jobBaseCount × jobBaseReward) / lifeTaxRate`. Credit cycles cause medium-term oscillations above and below this level. Shocks cause acute contractions.

---

## Parameter Tuning Reference

See [CONFIG.md](CONFIG.md) for the full parameter reference.

### Quick-tuning heuristics

**To increase stratification:** Raise `memoryProductivity` or lower `memoryMintPerTick`. Memory becomes more scarce → those who have it earn disproportionately more.

**To increase turnover (more deaths):** Raise `lifeTaxBase` or lower `jobBaseReward`. The margin between income and expense narrows; unlucky agents die faster.

**To reduce turnover (more stability):** Lower `lifeTaxBase` or raise `jobBaseCount`. More slack in the economy.

**To make credit crises more frequent:** Raise `loanRate` or lower `loanTerm`. Debt becomes harder to service; defaults more likely.

**To get faster monopoly formation:** Raise `memoryProductivity` and `maxProductivityMult`. The compounding advantage accelerates.

**To get slower, richer cycles:** Raise `ticksPerCycle`. More events between each Chronicler dispatch; more drama per episode.
