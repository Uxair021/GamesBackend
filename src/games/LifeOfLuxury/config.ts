/** Centralized rules for Life of Luxury — a classic 5-reel x 3-row, 15-fixed-payline slot.
 * Every number/rule the spec calls out lives here so winCalc.ts/engine.ts never scatter magic
 * numbers; the win-calc/RTP code reads this object, never hardcodes a payout or line pattern. */

export const SYMBOLS = [
  "AEROPLANE",
  "BOAT",
  "CAR",
  "RING",
  "MONEY",
  "WATCH",
  "GOLD_BAR",
  "SILVER_BAR",
  "BRONZE_BAR",
  "WILD",
  "COIN",
] as const;
export type LifeOfLuxurySymbol = (typeof SYMBOLS)[number];

/** The 9 regular (line-paying) symbols — everything except WILD and the COIN scatter. */
export const REGULAR_SYMBOLS = SYMBOLS.filter((s) => s !== "COIN" && s !== "WILD") as Exclude<
  LifeOfLuxurySymbol,
  "COIN" | "WILD"
>[];

/** The daimond.png wild — substitutes for any of the 9 regular symbols when matching a payline
 * run (see winCalc.ts's evaluatePayline), drawn from the same shared reel-strip weight table as
 * the 9 payers (see `tiers` in PaytableConfig), NOT an independent chance like COIN. Restricted
 * to WILD_ALLOWED_REELS below — engine.ts's drawGrid excludes it from the weight table entirely
 * on every other reel, so it can never appear there. */
export const WILD_SYMBOL: LifeOfLuxurySymbol = "WILD";

/** 0-indexed reels the wild is allowed to land on — reels 2/3/4 in player-facing (1-indexed)
 * terms, never reel 1 or reel 5. Reels 0 and 4 therefore always show one of the 9 real symbols
 * with no dilution at all, which is why the payout table below is calibrated much lower than a
 * "normal" reel-strip game's — see computeLifeOfLuxuryRtpPercent in services/paytableConfig.ts
 * for the exact math this constraint forces. */
export const WILD_ALLOWED_REELS: readonly number[] = [1, 2, 3];

export const REEL_COUNT = 5;
export const ROW_COUNT = 3;
export const LINE_COUNT = 15;

/** The single amount staked and deducted per spin — no per-line split, no hidden multiplier.
 * What you bet is what's deducted; the 15 fixed paylines are all evaluated against that same
 * bet every spin. */
export const BET_LEVELS = [0.1, 0.2, 0.3, 0.4, 0.5, 1, 2, 5, 10, 15, 20, 25, 30];
export const MIN_BET = BET_LEVELS[0];
export const MAX_BET = BET_LEVELS[BET_LEVELS.length - 1];

/**
 * The 15 fixed payline patterns — one row index (0=top/1=mid/2=bottom) per reel, confirmed
 * directly against the user's reference diagram (not guessed).
 */
export const PAYLINES: readonly [number, number, number, number, number][] = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [2, 1, 0, 1, 2],
  [0, 1, 2, 1, 0],
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [1, 2, 1, 0, 1],
  [1, 0, 1, 2, 1],
  [0, 1, 0, 1, 0],
  [2, 1, 2, 1, 2],
  [0, 1, 1, 1, 0],
  [2, 1, 1, 1, 2],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
];

export interface SymbolPayout {
  x3: number;
  x4: number;
  x5: number;
}

/** 3/4/5-of-a-kind payouts (multiple of the bet, paid left-to-right, minimum 3, one payout per
 * line — the longest run from reel 1, WILD substituting) — admin-editable defaults, see
 * services/paytableConfig.ts. WILD used to be wired up as a dead "FILLER" (no substitution, no
 * reel restriction enforced, since the paytable's tiers row was literally keyed "FILLER" instead
 * of "WILD" — see paytableConfig.ts's git history) so these numbers were originally tuned against
 * a model where it contributed nothing to RTP at all. Once WILD genuinely substitutes and is
 * actually confined to reels 2-4 (see WILD_ALLOWED_REELS above), reels 1 and 5 always show a real
 * symbol with zero dilution and reels 2-4 get a substitution boost — that alone pushes RTP into
 * the hundreds of percent no matter how the reel-strip weights (tiers, in paytableConfig.ts) are
 * shaped (verified: even the theoretical minimum over that shape space is ~309%). The only lever
 * left to land back at the ~90% target is these payout multipliers themselves, scaled down
 * ~3.44x from the "WILD does nothing" numbers — see computeLifeOfLuxuryRtpPercent's comment in
 * services/paytableConfig.ts for the exact closed-form derivation (now WILD-aware). */
export const DEFAULT_SYMBOL_PAYOUTS: Record<Exclude<LifeOfLuxurySymbol, "COIN" | "WILD">, SymbolPayout> = {
  AEROPLANE: { x3: 2.7, x4: 26.97, x5: 269.69 },
  BOAT: { x3: 1.62, x4: 10.79, x5: 53.94 },
  CAR: { x3: 1.08, x4: 5.39, x5: 26.97 },
  RING: { x3: 0.81, x4: 4.05, x5: 10.79 },
  MONEY: { x3: 0.54, x4: 2.7, x5: 10.79 },
  WATCH: { x3: 0.54, x4: 1.62, x5: 8.09 },
  GOLD_BAR: { x3: 0.27, x4: 1.62, x5: 8.09 },
  SILVER_BAR: { x3: 0.27, x4: 1.08, x5: 6.47 },
  BRONZE_BAR: { x3: 0.27, x4: 1.08, x5: 5.39 },
};

export const SCATTER_SYMBOL: LifeOfLuxurySymbol = "COIN";
export const SCATTER_TRIGGER_COUNT = 3;

export interface ScatterRules {
  /** COIN's own independent chance (0-100) of landing on any single cell — rolled separately
   * from the `tiers` weight table, so it can stay genuinely rare regardless of how the other 10
   * symbols (9 payers + WILD) are weighted. Not affected by the payout-table rescale below —
   * it's a probability, not a payout amount. */
  chancePercent: number;
  /** Multiple of the bet — 3/4/5(+) coins anywhere on the grid. Scaled down with the rest of
   * DEFAULT_SYMBOL_PAYOUTS — see that constant's doc comment for why. */
  x3: number;
  x4: number;
  x5: number;
  /** Free spins awarded when COIN triggers on a *base* (non-free) spin. Per spec, a coin
   * scatter during an already-active free-spins round still pays its cash prize above, but
   * never awards more free spins — no retriggering, see engine.ts's spin(). */
  freeSpinsAwarded: number;
}

export const DEFAULT_SCATTER_RULES: ScatterRules = {
  chancePercent: 3,
  x3: 0.37,
  x4: 2.79,
  x5: 18.57,
  freeSpinsAwarded: 10,
};

export type { LifeOfLuxurySymbol as Symbol };
