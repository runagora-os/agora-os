import type { SimConfig } from "./config.js";
import type { Agent, MarketBook, ResourceKind, Trade } from "./types.js";

export const SYSTEM_ID = "SYSTEM";

/** A buy or sell order submitted to a resource market for one clearing round. */
export interface ClearingOrder {
  agent: string; // agent id, or SYSTEM_ID for the faucet
  qty: number;
  limitPrice: number;
}

export interface ClearResult {
  trades: Trade[];
  demand: number; // total units bid
  supply: number; // total units offered
  volume: number; // units actually traded
  clearingPrice: number;
}

/**
 * Clear one resource market with a simple double-auction. Buys sorted by
 * willingness-to-pay (desc), sells by ask (asc); match while the top buy meets
 * the top sell. Trade executes at the midpoint. Settlement is applied directly
 * to agents (the engine passes in the live agent map). SYSTEM orders are the
 * faucet: α paid to SYSTEM leaves circulation (a controlled sink); resource
 * received by SYSTEM simply disappears.
 */
export function clearResourceMarket(
  resource: ResourceKind,
  buys: ClearingOrder[],
  sells: ClearingOrder[],
  agents: Map<string, Agent>,
  tick: number,
): ClearResult {
  const demand = buys.reduce((s, o) => s + o.qty, 0);
  const supply = sells.reduce((s, o) => s + o.qty, 0);

  const b = [...buys].sort((x, y) => y.limitPrice - x.limitPrice);
  const s = [...sells].sort((x, y) => x.limitPrice - y.limitPrice);

  const trades: Trade[] = [];
  let volume = 0;
  let lastPrice = NaN;
  let bi = 0;
  let si = 0;

  while (bi < b.length && si < s.length) {
    const buy = b[bi]!;
    const sell = s[si]!;
    if (buy.limitPrice < sell.limitPrice) break; // no more crossing orders

    const price = (buy.limitPrice + sell.limitPrice) / 2;
    let qty = Math.min(buy.qty, sell.qty);

    // Validate against real balances (buyer α, seller resource).
    if (buy.agent !== SYSTEM_ID) {
      const buyer = agents.get(buy.agent);
      if (!buyer || !buyer.alive) {
        bi++;
        continue;
      }
      const affordable = Math.floor(buyer.wallet / Math.max(price, 1e-6));
      qty = Math.min(qty, affordable);
    }
    if (sell.agent !== SYSTEM_ID) {
      const seller = agents.get(sell.agent);
      if (!seller || !seller.alive) {
        si++;
        continue;
      }
      qty = Math.min(qty, Math.floor(seller.resources[resource]));
    }

    if (qty < 1) {
      // Whichever side can't fulfill, advance it.
      if (buy.qty <= sell.qty) bi++;
      else si++;
      continue;
    }

    const cost = price * qty;
    // Settle buyer.
    if (buy.agent !== SYSTEM_ID) {
      const buyer = agents.get(buy.agent)!;
      buyer.wallet -= cost;
      buyer.resources[resource] += qty;
    }
    // Settle seller.
    if (sell.agent !== SYSTEM_ID) {
      const seller = agents.get(sell.agent)!;
      seller.wallet += cost;
      seller.resources[resource] -= qty;
    }

    trades.push({
      buyer: buy.agent,
      seller: sell.agent,
      resource,
      qty,
      price,
      tick,
    });
    volume += qty;
    lastPrice = price;

    buy.qty -= qty;
    sell.qty -= qty;
    if (buy.qty <= 0) bi++;
    if (sell.qty <= 0) si++;
  }

  return { trades, demand, supply, volume, clearingPrice: lastPrice };
}

/** Reprice a resource from realized demand vs supply, clamped to bounds. */
export function updatePrice(book: MarketBook, config: SimConfig): void {
  const { demand, supply } = { demand: book.lastDemand, supply: book.lastSupply };
  const bounds = config.priceBounds[book.resource];
  const pressure = (demand - supply) / Math.max(supply, 1);
  const next = book.price * (1 + config.priceK * pressure);
  book.price = Math.min(bounds.max, Math.max(bounds.min, next));
  book.priceHistory.push(book.price);
  if (book.priceHistory.length > config.priceHistoryLen) book.priceHistory.shift();
}
