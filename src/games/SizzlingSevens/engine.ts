import { PaytableConfigDTO } from "../../services/paytableConfig";
import { TierRow } from "../../models/PaytableConfig";
import { WinTierName, WinTier, getWinTier } from "../../gameTiers";
import {
  Grid,
  Paytable,
  SpinEvaluation,
  calculateSpinWin,
  triggerFreeGames,
  pickFreeSpinMultiplier,
  FreeGamesTrigger,
} from "./winCalc";
import { SYMBOLS, SizzlingSymbol, REEL_COUNT, ROW_COUNT, DEFAULT_PAYTABLE, PURE_WILD_PAYOUT, WILD_SYMBOL } from "./config";

const SYMBOL_SET = new Set<string>(SYMBOLS);

/** True iff `value` is a well-formed REEL_COUNT x ROW_COUNT grid of real symbol strings — the
 * shape a client-supplied grid (see spinWithGrid below) must satisfy before it's trusted. */
export function isValidGrid(value: unknown): value is Grid {
  if (!Array.isArray(value) || value.length !== REEL_COUNT) return false;
  return value.every(
    (column) => Array.isArray(column) && column.length === ROW_COUNT && column.every((s) => typeof s === "string" && SYMBOL_SET.has(s))
  );
}

export interface SpinResult {
  grid: Grid;
  evaluation: SpinEvaluation;
  winAmount: number;
  tier: WinTierName | null;
  /** Present only when this spin's Bonus trigger (scatterCount >= 3) awards Free Games. */
  freeGamesAward: FreeGamesTrigger | null;
}

/** Weighted-random symbol pick from the admin-configured `tiers` table (one row per symbol,
 * frequencyPercent = its reel-strip weight, summing to 100%). Same helper shape as every other
 * game's rollTier. */
function weightedSymbol(tiers: TierRow[]): SizzlingSymbol {
  const total = tiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  let roll = Math.random() * total;
  for (const tier of tiers) {
    roll -= tier.frequencyPercent;
    if (roll < 0) return tier.key as SizzlingSymbol;
  }
  return tiers[tiers.length - 1].key as SizzlingSymbol;
}

/** Draws a full 3x3 grid — every cell independently drawn from the same shared weighted
 * symbol table (no per-reel asymmetry, matching the admin's single weight table). */
export function drawGrid(tiers: TierRow[]): Grid {
  const grid: Grid = [];
  for (let reel = 0; reel < REEL_COUNT; reel++) {
    const column: SizzlingSymbol[] = [];
    for (let row = 0; row < ROW_COUNT; row++) column.push(weightedSymbol(tiers));
    grid.push(column);
  }
  return grid;
}

/** Admin-configured 3-match payouts (from each symbol's own tier row), falling back to the
 * built-in defaults for any row left unset. WILD_2X's row holds the 3-Wild pure payout only
 * (see paytableFor below) — it has no "3 matching WILD_2X" entry in Paytable itself. */
function paytableFrom(tiers: TierRow[]): Paytable {
  const paytable: Paytable = { ...DEFAULT_PAYTABLE };
  for (const tier of tiers) {
    if (tier.key === WILD_SYMBOL || tier.payoutMultiplier === null) continue;
    if ((SYMBOLS as readonly string[]).includes(tier.key) && tier.key in paytable) {
      (paytable as Record<string, number>)[tier.key] = tier.payoutMultiplier;
    }
  }
  return paytable;
}

/** The admin-editable 3-Wild pure payout, falling back to the spec default. 1/2-Wild stay
 * fixed (not worth their own admin rows) — see config.ts's PURE_WILD_PAYOUT comment. */
export function pureWildPayoutFrom(tiers: TierRow[]): typeof PURE_WILD_PAYOUT {
  const wildRow = tiers.find((t) => t.key === WILD_SYMBOL);
  return { 1: PURE_WILD_PAYOUT[1], 2: PURE_WILD_PAYOUT[2], 3: wildRow?.payoutMultiplier ?? PURE_WILD_PAYOUT[3] };
}

const DEFAULT_THRESHOLDS: NonNullable<PaytableConfigDTO["amountThresholds"]> = {
  simpleWinMax: 0,
  bigWinMin: 3,
  megaWinMin: 6,
  jackpotMin: 12,
  zeroRespinMin: 0,
  zeroRespinMax: 0,
};

/** Celebration tier is picked by bucketing finalWin as a multiple of the *total* bet (same
 * "amountThresholds reused as multiplier cutoffs" pattern as 5x Rewind). Since finalWin scales
 * with betMultiplier exactly like totalBet does, this ratio is actually bet-independent — it's
 * really just (basePayout x wildMultiplier) / LINE_COST, i.e. how big a win is relative to the
 * flat 30-coin line cost. Picked from the actual simulated win distribution at the current
 * payout table/weights (see services/paytableConfig.ts's DEFAULT_CONFIGS comment) —
 * bigWinMin≈p97, megaWinMin≈p99.5, jackpotMin≈p99.9 of non-zero wins, so they read as
 * meaningfully rare without being unreachable. */
function celebrationTier(finalWin: number, totalBet: number, thresholds: NonNullable<PaytableConfigDTO["amountThresholds"]>): WinTierName | null {
  const multiple = totalBet > 0 ? finalWin / totalBet : 0;
  const tiers: WinTier[] = [
    { name: "JACKPOT", minAmount: thresholds.jackpotMin },
    { name: "MEGA WIN", minAmount: thresholds.megaWinMin },
    { name: "BIG WIN", minAmount: thresholds.bigWinMin },
  ];
  return getWinTier(tiers, multiple);
}

function resolve(
  grid: Grid,
  betMultiplier: number,
  totalBet: number,
  paytableConfig: PaytableConfigDTO,
  freeGameMultiplierPool: number[] | null
): SpinResult {
  const paytable = paytableFrom(paytableConfig.tiers);
  const pureWildPayout = pureWildPayoutFrom(paytableConfig.tiers);
  const freeGameMultiplier = freeGameMultiplierPool ? pickFreeSpinMultiplier(freeGameMultiplierPool) : 1;

  const evaluation = calculateSpinWin(grid, paytable, betMultiplier, freeGameMultiplier, pureWildPayout);
  const freeGamesAward = evaluation.triggeredFreeGames ? triggerFreeGames() : null;

  const thresholds = paytableConfig.amountThresholds ?? DEFAULT_THRESHOLDS;
  const tier = celebrationTier(evaluation.finalWin, totalBet, thresholds);

  return { grid, evaluation, winAmount: evaluation.finalWin, tier, freeGamesAward };
}

/**
 * Plays one spin with a *server-drawn* grid. `betMultiplier` is the player-selected multiplier
 * (1/2/3/5/10 — see config.ts); `totalBet` is LINE_COST * betMultiplier, already computed by
 * the caller so the exact same value used for balance deduction also drives line-win payouts.
 * `freeGameMultiplierPool` non-null means this is a spin *within* an active Free Games round —
 * a fresh multiplier is drawn from that pool and applied to everything this spin wins.
 *
 * Superseded by spinWithGrid for normal play (the reel now determines its own result by
 * freezing wherever the player clicks Stop, not a server-predetermined target — see
 * SizzlingSevensGame.tsx) — kept for admin/testing paths that still want a fresh random grid.
 */
export function spin(betMultiplier: number, totalBet: number, paytableConfig: PaytableConfigDTO, freeGameMultiplierPool: number[] | null = null): SpinResult {
  const grid = drawGrid(paytableConfig.tiers);
  return resolve(grid, betMultiplier, totalBet, paytableConfig, freeGameMultiplierPool);
}

/**
 * Scores a *client-supplied* grid — the reel's own continuous scroll (using the same
 * admin-configured weights, replicated client-side) determines what's showing when the player
 * clicks Stop, and that's what's sent here to be evaluated/paid. The server no longer decides
 * the outcome; it only computes what a given grid is worth and moves the balance accordingly.
 * Caller must validate `grid` with isValidGrid first.
 */
export function spinWithGrid(
  grid: Grid,
  betMultiplier: number,
  totalBet: number,
  paytableConfig: PaytableConfigDTO,
  freeGameMultiplierPool: number[] | null = null
): SpinResult {
  return resolve(grid, betMultiplier, totalBet, paytableConfig, freeGameMultiplierPool);
}

/** Safe filler for the forced-outcome preview below — cycles 3 non-BAR symbols with a per-reel
 * offset so no payline accidentally runs 3+ deep on its own (a little incidental overlap is
 * harmless for an admin preview tool, this just keeps it minor). */
const FILLER_CYCLE: SizzlingSymbol[] = ["BLUE_7", "DOUBLE_BAR", "TRIPLE_BAR"];
function fillerGrid(): Grid {
  const grid: Grid = [];
  for (let reel = 0; reel < REEL_COUNT; reel++) {
    const column: SizzlingSymbol[] = [];
    for (let row = 0; row < ROW_COUNT; row++) column.push(FILLER_CYCLE[(reel + row) % FILLER_CYCLE.length]);
    grid.push(column);
  }
  return grid;
}

/** Sets payline 1 (the flat middle row, all 3 reels) to `symbols` on top of a safe filler
 * grid — used by the admin forced-outcome tool below. */
function gridWithMiddleRow(symbols: [SizzlingSymbol, SizzlingSymbol, SizzlingSymbol]): Grid {
  const grid = fillerGrid();
  symbols.forEach((s, reel) => (grid[reel][1] = s));
  return grid;
}

const FORCED_GRIDS: Record<WinTierName, Grid> = {
  "BIG WIN": gridWithMiddleRow(["WILD_2X", "RED_7", "RED_7"]),
  "MEGA WIN": gridWithMiddleRow(["WILD_2X", "WILD_2X", "RED_7"]),
  JACKPOT: gridWithMiddleRow(["WILD_2X", "WILD_2X", "WILD_2X"]),
};

export function spinForTier(betMultiplier: number, totalBet: number, targetTier: WinTierName, paytableConfig: PaytableConfigDTO): SpinResult {
  const grid = FORCED_GRIDS[targetTier];
  const paytable = paytableFrom(paytableConfig.tiers);
  const pureWildPayout = pureWildPayoutFrom(paytableConfig.tiers);
  const evaluation = calculateSpinWin(grid, paytable, betMultiplier, 1, pureWildPayout);
  const freeGamesAward = evaluation.triggeredFreeGames ? triggerFreeGames() : null;
  return { grid, evaluation, winAmount: evaluation.finalWin, tier: targetTier, freeGamesAward };
}
