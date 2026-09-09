/** Centralized rules for 7 Crystal Clover — a classic 3-reel x 3-row, 9-fixed-payline slot.
 * Outcome-first, same shape as ShamrockSpin/Buffalo777/5x Rewind (see engine.ts's doc comment):
 * one discrete win-tier is rolled per spin from the admin's `tiers` (loss/simpleWin/bigWin/
 * megaWin/jackpot — payout comes straight from that tier's own payoutMultiplier), a specific
 * WIN_RULE_ID is picked cosmetically within that tier (see `ruleTierMap`, purely decorative —
 * doesn't affect payout), and the MULTIPLIER_2X count is a second, independent roll
 * (`specialReelTiers`, mirrors Crazy 777's reel-4 pattern) applied as a flat ×1/×2/×4/×8 on top. */

export const SYMBOLS = ["SEVEN_CLOVER", "TRIPLE_BAR", "DOUBLE_BAR", "BAR", "WILD", "MULTIPLIER_2X"] as const;
export type CrystalCloverSymbol = (typeof SYMBOLS)[number];

export const REEL_COUNT = 3;
export const ROW_COUNT = 3;
export const TOP = 0;
export const MIDDLE = 1;
export const BOTTOM = 2;

export const BET_LEVELS = [0.1, 0.25, 0.5, 1, 2, 3, 5, 10, 15, 20, 25, 30];
export const MIN_BET = BET_LEVELS[0];
export const MAX_BET = BET_LEVELS[BET_LEVELS.length - 1];

/**
 * The 9 fixed payline patterns — one row index (0/1/2) per reel. This is the universal
 * "standard 9-line" reference layout used across classic 3x3 slots (confirmed with the user as
 * the same base pattern Sizzling 7s's first 9 lines already use): 3 straight rows, the 2
 * diagonals, and the 4 V/Λ variants. Under the outcome-first model (see engine.ts), a winning
 * spin's line is picked uniformly at random from these 9 — richer than ShamrockSpin (which only
 * ever uses its one middle row) since Crystal Clover's frontend already knows how to trace every
 * diagonal/V shape (see pixi/CrystalCloverScene.ts's drawPaylineTrace).
 */
export const PAYLINES: readonly [number, number, number][] = [
  [1, 1, 1], // 1 - MMM
  [0, 0, 0], // 2 - TTT
  [2, 2, 2], // 3 - BBB
  [0, 1, 2], // 4 - top-mid-bottom diagonal
  [2, 1, 0], // 5 - bottom-mid-top diagonal
  [0, 2, 0], // 6 - top-bottom-top (upper Λ)
  [2, 0, 2], // 7 - bottom-top-bottom (lower Λ)
  [1, 0, 1], // 8 - mid-top-mid (∧)
  [1, 2, 1], // 9 - mid-bottom-mid (∨)
];

export const WILD_SYMBOL: CrystalCloverSymbol = "WILD";
export const MULTIPLIER_SYMBOL: CrystalCloverSymbol = "MULTIPLIER_2X";

/** The 3 BAR-family symbols — a rolled ANY_BAR win renders as a mixed (non-identical) run of
 * these three; also used to keep safe filler cells from accidentally producing a stray BAR-family
 * match elsewhere on the grid (see engine.ts's buildGridForRule). */
export const BAR_FAMILY: CrystalCloverSymbol[] = ["BAR", "DOUBLE_BAR", "TRIPLE_BAR"];

/**
 * Every cosmetic win pattern the reels can render, independent of payout (see this file's top
 * doc comment) — mirrors ShamrockSpin's WinRuleId exactly. `ruleTierMap` (admin-editable, see
 * models/PaytableConfig.ts) decides which of `simpleWin`/`bigWin`/`megaWin`/`jackpot` each one
 * actually pays as; the id itself only decides which symbols get drawn.
 */
export const WIN_RULE_IDS = [
  "SEVEN_CLOVER",
  "TRIPLE_BAR",
  "DOUBLE_BAR",
  "BAR",
  "ANY_BAR",
  "ONE_WILD",
  "TWO_WILD",
  "THREE_WILD",
] as const;
export type WinRuleId = (typeof WIN_RULE_IDS)[number];

export type { CrystalCloverSymbol as Symbol };
