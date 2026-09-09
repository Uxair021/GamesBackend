import { PaytableConfigDTO } from "../../services/paytableConfig";
import { TierRow } from "../../models/PaytableConfig";
import { WinTierName, WinTier, getWinTier } from "../../gameTiers";
import { Grid, SymbolPayoutTable, SpinEvaluation, calculateSpinWin } from "./winCalc";
import {
  SYMBOLS,
  LifeOfLuxurySymbol,
  REEL_COUNT,
  ROW_COUNT,
  DEFAULT_SYMBOL_PAYOUTS,
  DEFAULT_SCATTER_RULES,
  SCATTER_SYMBOL,
  WILD_ALLOWED_REELS,
} from "./config";

export interface SpinResult {
  grid: Grid;
  evaluation: SpinEvaluation;
  winAmount: number;
  tier: WinTierName | null;
  /** Present only when this spin's Coin scatter (count >= 3) awards free spins — never set for
   * a spin played during an already-active free-spins round (no retriggering, see spin()). */
  freeSpinsAwarded: number | null;
}

/** Weighted-random symbol pick from the admin-configured `tiers` table — 10 rows, one per
 * regular symbol plus WILD, summing to 100%. COIN is deliberately NOT one of these rows — it's
 * rolled as its own independent chance in drawGrid below, not a share of this table. */
function weightedSymbol(tiers: TierRow[]): LifeOfLuxurySymbol {
  const total = tiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  let roll = Math.random() * total;
  for (const tier of tiers) {
    roll -= tier.frequencyPercent;
    if (roll < 0) return tier.key as LifeOfLuxurySymbol;
  }
  return tiers[tiers.length - 1].key as LifeOfLuxurySymbol;
}

/** Every cell independently rolls: is this COIN (its own admin-configured chance)? If not, draw
 * from the 10-row weight table (9 payout symbols + WILD) — except on a reel outside
 * WILD_ALLOWED_REELS, where WILD's row is excluded first (and the remaining 9 payers'
 * proportions renormalize automatically, since weightedSymbol divides by whatever total the
 * rows it's given sum to), so WILD can never land there. A plain classic 5x3 grid, always fully
 * filled. */
export function drawGrid(tiers: TierRow[], scatterChancePercent: number): Grid {
  const tiersNoWild = tiers.filter((t) => t.key !== "WILD");
  const grid: Grid = [];
  for (let reel = 0; reel < REEL_COUNT; reel++) {
    const reelTiers = WILD_ALLOWED_REELS.includes(reel) ? tiers : tiersNoWild;
    const column: LifeOfLuxurySymbol[] = [];
    for (let row = 0; row < ROW_COUNT; row++) {
      column.push(Math.random() * 100 < scatterChancePercent ? SCATTER_SYMBOL : weightedSymbol(reelTiers));
    }
    grid.push(column);
  }
  return grid;
}

/** Admin-configured symbol payouts, falling back to the built-in defaults for any symbol left
 * unset. COIN/WILD have no entry (their payout is `scatterRules`/none — WILD substitutes into
 * whatever real symbol's run it joins, it has no payout of its own). */
function paytableFrom(config: PaytableConfigDTO): SymbolPayoutTable {
  const table = { ...DEFAULT_SYMBOL_PAYOUTS };
  if (config.symbolPayouts) {
    for (const symbol of Object.keys(table) as (keyof SymbolPayoutTable)[]) {
      const row = config.symbolPayouts[symbol];
      if (row) table[symbol] = { x3: row.x3, x4: row.x4, x5: row.x5 };
    }
  }
  return table;
}

function scatterRulesFrom(config: PaytableConfigDTO) {
  return config.scatterRules ?? DEFAULT_SCATTER_RULES;
}

/** Bet-multiple cutoffs — picked so each of the 3 forced-outcome grids below (single-symbol,
 * single-line 5-of-a-kind) lands cleanly in its own bucket; see FORCED_GRIDS' doc comment for
 * the exact numbers. Admin-editable via the same generic `amountThresholds` field every other
 * game uses. */
const DEFAULT_THRESHOLDS: NonNullable<PaytableConfigDTO["amountThresholds"]> = {
  simpleWinMax: 0,
  bigWinMin: 20,
  megaWinMin: 35,
  jackpotMin: 300,
  zeroRespinMin: 0,
  zeroRespinMax: 0,
};

function celebrationTier(finalWin: number, bet: number, thresholds: NonNullable<PaytableConfigDTO["amountThresholds"]>): WinTierName | null {
  const multiple = bet > 0 ? finalWin / bet : 0;
  const tiers: WinTier[] = [
    { name: "JACKPOT", minAmount: thresholds.jackpotMin },
    { name: "MEGA WIN", minAmount: thresholds.megaWinMin },
    { name: "BIG WIN", minAmount: thresholds.bigWinMin },
  ];
  return getWinTier(tiers, multiple);
}

function resolve(grid: Grid, bet: number, config: PaytableConfigDTO, isFreeSpin: boolean): SpinResult {
  const paytable = paytableFrom(config);
  const scatterRules = scatterRulesFrom(config);
  const evaluation = calculateSpinWin(grid, paytable, bet, scatterRules);
  // No retriggering: a coin scatter during an already-active free-spins round still pays its
  // cash prize (see evaluation.scatter.win above) but never awards more free spins.
  const freeSpinsAwarded = evaluation.scatter.triggered && !isFreeSpin ? scatterRules.freeSpinsAwarded : null;

  const thresholds = config.amountThresholds ?? DEFAULT_THRESHOLDS;
  const tier = celebrationTier(evaluation.finalWin, bet, thresholds);

  return { grid, evaluation, winAmount: evaluation.finalWin, tier, freeSpinsAwarded };
}

/**
 * Runs one authoritative, server-drawn spin — classic auto-stop: the server decides the whole
 * grid and result in one call; the client only ever plays a fixed-duration landing animation on
 * whatever this returns. `bet` is the single amount staked and evaluated against every line and
 * the scatter alike — no per-line split.
 */
export function spin(bet: number, config: PaytableConfigDTO, isFreeSpin = false): SpinResult {
  const scatterRules = scatterRulesFrom(config);
  const grid = drawGrid(config.tiers, scatterRules.chancePercent);
  return resolve(grid, bet, config, isFreeSpin);
}

/** Fills the middle row (payline 1) with `symbol` and alternates two other regular symbols
 * across the top/bottom rows so no other one of the 15 lines can accidentally also match (every
 * other line either stays within a single alternating row — max run 1 — or starts at reel 1 on
 * a filler symbol that immediately breaks against the next cell) — see engine.ts's plan notes
 * for the full per-line verification. Used only by the admin forced-outcome tool below. */
function gridWithMiddleRow(symbol: LifeOfLuxurySymbol, fillerA: LifeOfLuxurySymbol, fillerB: LifeOfLuxurySymbol): Grid {
  const grid: Grid = [];
  for (let reel = 0; reel < REEL_COUNT; reel++) {
    const top = reel % 2 === 0 ? fillerA : fillerB;
    const bottom = reel % 2 === 0 ? fillerB : fillerA;
    grid.push([top, symbol, bottom]);
  }
  return grid;
}

/** Picked (at the default paytable) to land in their own celebration bucket and no other — each
 * is a clean single-line 5-of-a-kind (x5 payout, as a multiple of bet): SILVER_BAR = 120x (BIG),
 * RING = 200x (MEGA), AEROPLANE = 5000x (JACKPOT) — see DEFAULT_THRESHOLDS above. */
const FORCED_GRIDS: Record<WinTierName, Grid> = {
  "BIG WIN": gridWithMiddleRow("SILVER_BAR", "GOLD_BAR", "CAR"),
  "MEGA WIN": gridWithMiddleRow("RING", "GOLD_BAR", "CAR"),
  JACKPOT: gridWithMiddleRow("AEROPLANE", "GOLD_BAR", "CAR"),
};

export function spinForTier(bet: number, targetTier: WinTierName, config: PaytableConfigDTO): SpinResult {
  const grid = FORCED_GRIDS[targetTier];
  return resolve(grid, bet, config, false);
}

export { SYMBOLS };
