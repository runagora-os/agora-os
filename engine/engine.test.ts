import { describe, it, expect } from "vitest";
import { Engine } from "./engine.js";
import { configForPhase } from "./config.js";
import { Rng } from "./rng.js";
import { gini } from "./metrics.js";

function runToTick(seed: string, phase: 1 | 2 | 3, ticks: number) {
  const engine = new Engine(configForPhase(phase, { seed }));
  const trail: number[] = [];
  for (let i = 0; i < ticks; i++) {
    const { metrics } = engine.step();
    trail.push(metrics.aliveAgents, Math.round(metrics.moneySupply * 100));
  }
  return trail;
}

describe("determinism", () => {
  it("same seed => identical history", () => {
    const a = runToTick("seed-x", 3, 120);
    const b = runToTick("seed-x", 3, 120);
    expect(a).toEqual(b);
  });

  it("different seeds => different history", () => {
    const a = runToTick("seed-x", 3, 120);
    const b = runToTick("seed-y", 3, 120);
    expect(a).not.toEqual(b);
  });
});

describe("Rng", () => {
  it("is reproducible", () => {
    const r1 = new Rng("abc");
    const r2 = new Rng("abc");
    const s1 = Array.from({ length: 100 }, () => r1.float());
    const s2 = Array.from({ length: 100 }, () => r2.float());
    expect(s1).toEqual(s2);
  });

  it("int stays within bounds", () => {
    const r = new Rng(42);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
    }
  });
});

describe("gini", () => {
  it("is 0 for perfect equality", () => {
    expect(gini([5, 5, 5, 5])).toBeCloseTo(0, 5);
  });
  it("approaches 1 for extreme concentration", () => {
    expect(gini([0, 0, 0, 100])).toBeGreaterThan(0.6);
  });
});

describe("living range (anti-collapse / anti-stasis)", () => {
  function finalState(phase: 1 | 2 | 3, ticks: number) {
    const engine = new Engine(configForPhase(phase, { seed: "living" }));
    let m = engine.step().metrics;
    let maxGini = 0;
    for (let i = 1; i < ticks; i++) {
      m = engine.step().metrics;
      maxGini = Math.max(maxGini, m.gini);
    }
    return { alive: m.aliveAgents, money: m.moneySupply, maxGini };
  }

  it("phase 1 does not go extinct and stratifies", () => {
    const { alive, maxGini } = finalState(1, 500);
    expect(alive).toBeGreaterThan(10); // no extinction
    expect(alive).toBeLessThan(50); // some die-off happened (drama)
    expect(maxGini).toBeGreaterThan(0.15); // inequality emerges
  });

  it("phase 2 sustains a trading economy (no extinction, no utopia)", () => {
    const { alive, money, maxGini } = finalState(2, 600);
    expect(alive).toBeGreaterThan(6);
    expect(money).toBeGreaterThan(0);
    expect(maxGini).toBeGreaterThan(0.2); // capital stratifies wealth
  });

  it("phase 3 sustains a credit economy without instant wipeout", () => {
    const { alive, money } = finalState(3, 600);
    expect(alive).toBeGreaterThan(6);
    expect(money).toBeGreaterThan(0);
  });
});

describe("conservation & survival", () => {
  it("money supply never goes NaN and agents never resurrect", () => {
    const engine = new Engine(configForPhase(1, { seed: "conserve" }));
    let prevAlive = Infinity;
    for (let i = 0; i < 200; i++) {
      const { metrics } = engine.step();
      expect(Number.isFinite(metrics.moneySupply)).toBe(true);
      // Alive count is monotonically non-increasing in phase 1 (no births).
      expect(metrics.aliveAgents).toBeLessThanOrEqual(prevAlive);
      prevAlive = metrics.aliveAgents;
    }
  });
});
