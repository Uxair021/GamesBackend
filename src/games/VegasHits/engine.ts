import { PaytableConfigDTO } from "../../services/paytableConfig";
import { TierRow } from "../../models/PaytableConfig";
import { WinTierName, WinTier, getWinTier } from "../../gameTiers";
import { Grid, Paytable, SpinEvaluation, WildRules, calculateSpinWin, triggerFreeGames, pickChiliMultiplier, FreeGamesTrigger } from "./winCalc";
import { SYMBOLS, VegasHitsSymbol, REEL_COUNT, ROW_COUNT, DEFAULT_PAYTABLE, DEFAULT_WILD_RULES, WILD_SYMBOL, BONUS_SYMBOL } from "./config";

export interface SpinResult {
  grid: Grid;
  evaluation: SpinEvaluation;
  winAmount: number;
  tier: WinTierName | null;
  /** Present only when this spin's Bonus trigger (scatterCount >= 3) awards Free Games. */
  freeGamesAward: FreeGamesTrigger | null;
}

/** Weighted-random symbol pick from the admin-configured `tiers` table (one row per symbol,
 * frequencyPercent = its reel-strip weight, summing to 100%). Same helper shape as Sizzling
 * 7s'/Crystal Clover's rollTier. */
function weightedSymbol(tiers: TierRow[]): VegasHitsSymbol {
  const total = tiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  let roll = Math.random() * total;
  for (const tier of tiers) {
    roll -= tier.frequencyPercent;
    if (roll < 0) return tier.key as VegasHitsSymbol;
  }
  return tiers[tiers.length - 1].key as VegasHitsSymbol;
}

/** Each reel independently rolls one of 2 states (mirrors 7 Crystal Clover's rollReelState
 * exactly): CENTER shows 1 symbol on the middle row only (top/bottom empty), TOP_BOTTOM shows 2
 * symbols on the top+bottom rows only (middle empty) — never all 3 filled. */
function rollReelState(centerRowChancePercent: number): "CENTER" | "TOP_BOTTOM" {
  return Math.random() * 100 < centerRowChancePercent ? "CENTER" : "TOP_BOTTOM";
}

/** Draws a full grid — each reel independently rolls its 2-state shape (see rollReelState) and
 * fills only the row(s) that state calls for, each from the same shared weighted symbol table. */
export function drawGrid(tiers: TierRow[], centerRowChancePercent: number): Grid {
  const grid: Grid = [];
  for (let reel = 0; reel < REEL_COUNT; reel++) {
    const column: (VegasHitsSymbol | null)[] = new Array(ROW_COUNT).fill(null);
    if (rollReelState(centerRowChancePercent) === "CENTER") {
      column[1] = weightedSymbol(tiers);
    } else {
      column[0] = weightedSymbol(tiers);
      column[2] = weightedSymbol(tiers);
    }
    grid.push(column);
  }
  return grid;
}

/** Admin-configured 3-match payouts (from each symbol's own tier row), falling back to the
 * built-in defaults for any row left unset. WILD/BONUS have no entry in Paytable itself — WILD
 * never pays directly (only its line multiplier applies), BONUS pays a fixed 1X total bet (see
 * winCalc.ts's calculateScatterWin), not an admin-tunable value. */
function paytableFrom(tiers: TierRow[]): Paytable {
  const paytable: Paytable = { ...DEFAULT_PAYTABLE };
  for (const tier of tiers) {
    if (tier.key === WILD_SYMBOL || tier.key === BONUS_SYMBOL || tier.payoutMultiplier === null) continue;
    if ((SYMBOLS as readonly string[]).includes(tier.key) && tier.key in paytable) {
      (paytable as Record<string, number>)[tier.key] = tier.payoutMultiplier;
    }
  }
  return paytable;
}

/** Bet-multiple cutoffs — picked from the simulated non-zero win distribution at the default
 * paytable/weights/wildRules (bigWinMin≈p97, megaWinMin≈p99.5, jackpotMin≈p99.9), same
 * convention Sizzling 7s uses. The Any-Mix rule (see config.ts's WildRules) pays a small amount
 * on the majority of non-wild live lines, so most wins here are modest and only the rarer
 * exact-match/wild-driven wins clear these cutoffs. */
const DEFAULT_THRESHOLDS: NonNullable<PaytableConfigDTO["amountThresholds"]> = {
  simpleWinMax: 0,
  bigWinMin: 15,
  megaWinMin: 35,
  jackpotMin: 70,
  zeroRespinMin: 0,
  zeroRespinMax: 0,
};

/** Celebration tier is picked by bucketing finalWin as a multiple of the *total* bet — same
 * "amountThresholds reused as multiplier cutoffs" pattern as Sizzling 7s. */
function celebrationTier(finalWin: number, totalBet: number, thresholds: NonNullable<PaytableConfigDTO["amountThresholds"]>): WinTierName | null {
  const multiple = totalBet > 0 ? finalWin / totalBet : 0;
  const tiers: WinTier[] = [
    { name: "JACKPOT", minAmount: thresholds.jackpotMin },
    { name: "MEGA WIN", minAmount: thresholds.megaWinMin },
    { name: "BIG WIN", minAmount: thresholds.bigWinMin },
  ];
  return getWinTier(tiers, multiple);
}

/** The admin-configured wild rules (see config.ts's WildRules doc comment), falling back to the
 * built-in defaults if unset (e.g. an older saved config predating this feature). */
function wildRulesFrom(paytableConfig: PaytableConfigDTO): WildRules {
  return paytableConfig.wildRules ?? DEFAULT_WILD_RULES;
}

function resolve(grid: Grid, betMultiplier: number, totalBet: number, paytableConfig: PaytableConfigDTO, chiliMultiplier: number): SpinResult {
  const paytable = paytableFrom(paytableConfig.tiers);
  const wildRules = wildRulesFrom(paytableConfig);
  const evaluation = calculateSpinWin(grid, paytable, wildRules, betMultiplier, totalBet, chiliMultiplier);
  const freeGamesAward = evaluation.triggeredFreeGames ? triggerFreeGames() : null;

  const thresholds = paytableConfig.amountThresholds ?? DEFAULT_THRESHOLDS;
  const tier = celebrationTier(evaluation.finalWin, totalBet, thresholds);

  return { grid, evaluation, winAmount: evaluation.finalWin, tier, freeGamesAward };
}

/**
 * Runs one authoritative, server-drawn spin — classic auto-stop, same shape as Crystal Clover's
 * spin(): the server decides the whole grid and result in one call; the client only ever plays
 * a fixed-duration landing animation on whatever this returns (see VegasHitsGame.tsx/pixi
 * Reel.spinTo). `betMultiplier` is totalBet/LINE_COST (see config.ts); `totalBet` is the
 * player's real selected bet, used as-is for the scatter win. `isFreeSpin` true means this spin
 * is played inside an active Free Games round — a fresh Chili Multiplier is drawn and applied
 * per the spec's exception (see winCalc.ts's calculateSpinWin).
 */
export function spin(betMultiplier: number, totalBet: number, paytableConfig: PaytableConfigDTO, isFreeSpin = false): SpinResult {
  const centerRowChancePercent = paytableConfig.reelStateConfig?.centerRowChancePercent ?? 50;
  const grid = drawGrid(paytableConfig.tiers, centerRowChancePercent);
  const chiliMultiplier = isFreeSpin ? pickChiliMultiplier() : 1;
  return resolve(grid, betMultiplier, totalBet, paytableConfig, chiliMultiplier);
}

/** All 3 reels forced into the CENTER state (top/bottom empty) with `symbols` on the middle
 * row — used by the admin forced-outcome tool below, guaranteeing payline 1 (the middle row). */
function gridWithMiddleRow(symbols: [VegasHitsSymbol, VegasHitsSymbol, VegasHitsSymbol]): Grid {
  return symbols.map((s) => [null, s, null]);
}

/** Picked (at the default paytable/wildRules) to actually land in their own tier and no other —
 * an exact 0-wild TRIPLE_GREEN_7 match, a 1-wild-completed DOUBLE_GREEN_7 (candidate A, see
 * winCalc.ts's evaluatePayline), and a 3-wild flat jackpot (candidate B) respectively. */
const FORCED_GRIDS: Record<WinTierName, Grid> = {
  "BIG WIN": gridWithMiddleRow(["TRIPLE_GREEN_7", "TRIPLE_GREEN_7", "TRIPLE_GREEN_7"]),
  "MEGA WIN": gridWithMiddleRow(["WILD", "DOUBLE_GREEN_7", "DOUBLE_GREEN_7"]),
  JACKPOT: gridWithMiddleRow(["WILD", "WILD", "WILD"]),
};

export function spinForTier(betMultiplier: number, totalBet: number, targetTier: WinTierName, paytableConfig: PaytableConfigDTO): SpinResult {
  const grid = FORCED_GRIDS[targetTier];
  const paytable = paytableFrom(paytableConfig.tiers);
  const wildRules = wildRulesFrom(paytableConfig);
  const evaluation = calculateSpinWin(grid, paytable, wildRules, betMultiplier, totalBet, 1);
  const freeGamesAward = evaluation.triggeredFreeGames ? triggerFreeGames() : null;
  return { grid, evaluation, winAmount: evaluation.finalWin, tier: targetTier, freeGamesAward };
}
