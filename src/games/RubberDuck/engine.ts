import { PaytableConfigDTO } from "../../services/paytableConfig";
import { TierRow } from "../../models/PaytableConfig";
import { WinTierName, WinTier, getWinTier } from "../../gameTiers";
import { Reels, PayoutTable, SpinEvaluation, evaluateSpin } from "./winCalc";
import { Symbol, PayingSymbol, REEL_COUNT, DEFAULT_PAYOUTS, DEFAULT_WEIGHTS, FRUIT_SYMBOLS } from "./config";

export interface SpinResult {
  reels: Reels;
  evaluation: SpinEvaluation;
  winAmount: number;
  tier: WinTierName | null;
}

/** Weighted-random symbol pick from the admin-configured `tiers` table — one row per symbol
 * (21 rows: 14 payers + BONUS + 6 fruits), summing to 100%. Mirrors LifeOfLuxury/VegasHits'
 * weightedSymbol exactly. */
function weightedSymbol(tiers: TierRow[]): Symbol {
  const total = tiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  let roll = Math.random() * total;
  for (const tier of tiers) {
    roll -= tier.frequencyPercent;
    if (roll < 0) return tier.key as Symbol;
  }
  return tiers[tiers.length - 1].key as Symbol;
}

/** Each of the 5 reels draws independently from the exact same weighted table — no per-reel
 * restriction (unlike LifeOfLuxury's WILD_ALLOWED_REELS), every symbol can land anywhere. */
export function drawReels(tiers: TierRow[]): Reels {
  const reels: Reels = [];
  for (let i = 0; i < REEL_COUNT; i++) reels.push(weightedSymbol(tiers));
  return reels;
}

/** Admin-configured payouts, falling back to the built-in defaults for any symbol left unset
 * (or a saved config from before this game existed). */
function paytableFrom(config: PaytableConfigDTO): PayoutTable {
  const table: PayoutTable = { ...DEFAULT_PAYOUTS };
  for (const tier of config.tiers) {
    if (tier.payoutMultiplier !== null && tier.key in table) {
      table[tier.key as PayingSymbol] = tier.payoutMultiplier;
    }
  }
  return table;
}

/** Bet-multiple cutoffs (finalWin / bet, same convention 5x Rewind/Sizzling 7s/Life of Luxury
 * use) — picked so the FORCED_REELS below (a single occurrence of one flagship symbol) each land
 * cleanly in their own bucket at the default paytable: SHAMPOO..BOAT (250x-1000x) = BIG WIN,
 * SEVEN/DOUBLE_7 (3100x/6095x) = MEGA WIN, TRIPLE_7 (10810x) = JACKPOT. Admin-editable via the
 * same generic `amountThresholds` field every other game uses. */
const DEFAULT_THRESHOLDS: NonNullable<PaytableConfigDTO["amountThresholds"]> = {
  simpleWinMax: 0,
  bigWinMin: 250,
  megaWinMin: 3000,
  jackpotMin: 8000,
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

function resolve(reels: Reels, bet: number, config: PaytableConfigDTO, isFreeSpin: boolean): SpinResult {
  const paytable = paytableFrom(config);
  const evaluation = evaluateSpin(reels, paytable, bet, isFreeSpin);
  const thresholds = config.amountThresholds ?? DEFAULT_THRESHOLDS;
  const tier = celebrationTier(evaluation.finalWin, bet, thresholds);
  return { reels, evaluation, winAmount: evaluation.finalWin, tier };
}

/** Runs one authoritative, server-drawn spin — the server decides all 5 reels and the result in
 * one call; the client only plays a fixed-duration landing animation on whatever this returns.
 * `bet` is staked/evaluated once, no per-line split (there's only one line). */
export function spin(bet: number, config: PaytableConfigDTO, isFreeSpin = false): SpinResult {
  const reels = drawReels(config.tiers.length > 0 ? config.tiers : defaultTiers());
  return resolve(reels, bet, config, isFreeSpin);
}

function defaultTiers(): TierRow[] {
  return (Object.keys(DEFAULT_WEIGHTS) as Symbol[]).map((key) => ({
    key: key as unknown as TierRow["key"],
    frequencyPercent: DEFAULT_WEIGHTS[key],
    payoutMultiplier: (DEFAULT_PAYOUTS as Record<string, number | undefined>)[key] ?? null,
    freeSpinPayoutMultiplier: null,
  }));
}

/** One representative symbol on reel 0, a fixed loss fruit filling the rest — used only by the
 * admin Force Outcome tool (BIG WIN/MEGA WIN/JACKPOT only, same 3-option limitation every other
 * game's forced-outcome path has). */
const FORCED_REELS: Record<WinTierName, Reels> = {
  "BIG WIN": ["BOAT", "AVOCADO", "AVOCADO", "AVOCADO", "AVOCADO"],
  "MEGA WIN": ["DOUBLE_7", "AVOCADO", "AVOCADO", "AVOCADO", "AVOCADO"],
  JACKPOT: ["TRIPLE_7", "AVOCADO", "AVOCADO", "AVOCADO", "AVOCADO"],
};

export function spinForTier(bet: number, targetTier: WinTierName, config: PaytableConfigDTO): SpinResult {
  return resolve(FORCED_REELS[targetTier], bet, config, false);
}

export { FRUIT_SYMBOLS };
