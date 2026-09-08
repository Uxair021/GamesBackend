import { Schema, model, Document } from "mongoose";
import { WinTierName } from "../gameTiers";

export type TierKey =
  | "loss"
  | "freeSpin"
  | "simpleWin"
  | "bigWin"
  | "megaWin"
  | "jackpot"
  | "zeroRespin"
  // Buffalo 777 only — each maps 1:1 to a specific symbol/combo so payouts stay exact
  // per-symbol rather than collapsed into the shared buckets above (see plan).
  | "ten"
  | "jack"
  | "queen"
  | "king"
  | "ace"
  | "bull"
  | "anyBar"
  | "singleBar"
  | "doubleBar"
  | "tripleBar"
  | "moneyBag"
  | "coin"
  // Crazy 777 only — line-side tiers (reels 1-3): exact 3-of-a-kind (share singleBar/
  // doubleBar/loss above; these 3 are new) plus 3 mixed-family "ANY" tiers (confirmed
  // against a reference build — reels 1-3 can also win on a mixed combo, not just an
  // exact match).
  | "sevenLow"
  | "sevenMid"
  | "sevenHigh"
  | "anySeven"
  | "anyGlobal"
  // Crazy 777 only — special-reel-side tiers (reel 4), stored in `specialReelTiers` below,
  // an entirely independent weighted table from `tiers`.
  | "multiplier2x"
  | "multiplier5x"
  | "multiplier10x"
  | "dollarPlus"
  | "doubleDollarPlus"
  | "respin"
  | "specialEmpty"
  // 5x Rewind only — line tiers (stored in `tiers`, same as every other game): loss + each
  // exact 3-of-a-kind + the 3 "ANY-3 mixed" categories. One outcome is rolled per spin, same
  // pattern as Crazy 777's reels 1-3, and its base (pre-coin) symbols are constructed to
  // match — see games/FiveXRewind/engine.ts.
  | "whiteBar"
  | "sevenBar"
  | "redBar"
  | "purpleBar"
  | "red7"
  | "purple7"
  | "blue7"
  | "any3BarOnly"
  | "any3BarWithSevenBar"
  | "any3Sevens"
  // 5x Rewind only — coin-overlay tiers (stored in `specialReelTiers`, reusing Crazy 777's
  // second-table field) — unlike Crazy 777 where that table is rolled once per spin, this one
  // is rolled independently for *each* of the 3 reels, deciding whether a coin replaces that
  // reel's line symbol. "noCoin" is the "nothing happens on this reel" outcome.
  | "noCoin"
  | "coin2x"
  | "coin3x"
  | "coin4x"
  | "coin5x"
  // Sizzling 7s only — one row per reel symbol (stored in `tiers`), used as the reel-strip
  // weight table: frequencyPercent is that symbol's draw weight (all 7 sum to 100%),
  // payoutMultiplier is its 3-matching payout (WILD_2X's row holds only the 3-Wild "pure
  // Wild" special payout — 1/2-Wild stay fixed, see games/SizzlingSevens/config.ts). Named
  // after the actual symbol (not camelCase like other games) so engine.ts can use the key
  // directly as the drawn Symbol with no translation map — see games/SizzlingSevens/engine.ts.
  | "RED_7"
  | "BLUE_7"
  | "BAR"
  | "DOUBLE_BAR"
  | "TRIPLE_BAR"
  | "WILD_2X"
  | "BONUS";

export interface TierRow {
  key: TierKey;
  /** Percent chance of this outcome on a single spin — all rows (across the whole game) sum to 100. */
  frequencyPercent: number;
  /** Multiplier of bet credited when this tier hits. null for "loss" and "freeSpin" (no direct payout).
   * For "zeroRespin" (Cash Machine only) this is an *estimated average* used only for the RTP preview —
   * the real per-spin payout is whatever digit value the respin reveals (see amountThresholds.zeroRespinMin/Max). */
  payoutMultiplier: number | null;
  /** ShamrockSpin win-tiers only — multiplier used instead of payoutMultiplier during a free-spin bonus round. */
  freeSpinPayoutMultiplier: number | null;
}

export interface IPaytableConfig extends Document {
  gameId: string;
  targetRtpPercent: number;
  /** ShamrockSpin only — bonus spins awarded when the "freeSpin" tier rolls. */
  freeSpinsGranted: number | null;
  tiers: TierRow[];
  /** ShamrockSpin only — which WIN_RULES render (cosmetically) for each win tier; payout comes from `tiers` above. */
  ruleTierMap: Record<string, "simpleWin" | "bigWin" | "megaWin" | "jackpot"> | null;
  /** Which celebration overlay (if any) each win tier triggers — admin-editable per tier.
   * null (or a tier missing from the map) means no celebration, just the plain win chime.
   * Crazy 777 keys this off the *special-reel* tier (see specialReelTiers), not `tiers`. */
  celebrationMap: Partial<Record<TierKey, WinTierName | null>> | null;
  /** Cash Machine only — editable amount thresholds, replacing the old hardcoded WIN_TIERS cutoffs. */
  amountThresholds: {
    simpleWinMax: number;
    bigWinMin: number;
    megaWinMin: number;
    jackpotMin: number;
    /** Range of the digit value the "0 → respin" mechanic is allowed to reveal. */
    zeroRespinMin: number;
    zeroRespinMax: number;
  } | null;
  /** Crazy 777 only — a second, fully independent weighted table for reel 4 (the special
   * reel), summing to 100% on its own, separate from `tiers`' 100% sum. */
  specialReelTiers: TierRow[] | null;
  /** Crazy 777 only — bounds for the RESPIN special-reel feature (random count per trigger). */
  respinRange: { min: number; max: number } | null;
  createdAt: Date;
  updatedAt: Date;
}

const tierRowSchema = new Schema<TierRow>(
  {
    key: {
      type: String,
      enum: [
        "loss",
        "freeSpin",
        "simpleWin",
        "bigWin",
        "megaWin",
        "jackpot",
        "zeroRespin",
        "ten",
        "jack",
        "queen",
        "king",
        "ace",
        "bull",
        "anyBar",
        "singleBar",
        "doubleBar",
        "tripleBar",
        "moneyBag",
        "coin",
        "sevenLow",
        "sevenMid",
        "sevenHigh",
        "anySeven",
        "anyGlobal",
        "multiplier2x",
        "multiplier5x",
        "multiplier10x",
        "dollarPlus",
        "doubleDollarPlus",
        "respin",
        "specialEmpty",
        "whiteBar",
        "sevenBar",
        "redBar",
        "purpleBar",
        "red7",
        "purple7",
        "blue7",
        "any3BarOnly",
        "any3BarWithSevenBar",
        "any3Sevens",
        "noCoin",
        "coin2x",
        "coin3x",
        "coin4x",
        "coin5x",
        "RED_7",
        "BLUE_7",
        "BAR",
        "DOUBLE_BAR",
        "TRIPLE_BAR",
        "WILD_2X",
        "BONUS",
      ],
      required: true,
    },
    frequencyPercent: { type: Number, required: true, min: 0, max: 100 },
    payoutMultiplier: { type: Number, default: null },
    freeSpinPayoutMultiplier: { type: Number, default: null },
  },
  { _id: false }
);

const paytableConfigSchema = new Schema<IPaytableConfig>(
  {
    gameId: { type: String, required: true, unique: true },
    targetRtpPercent: { type: Number, required: true },
    freeSpinsGranted: { type: Number, default: null },
    tiers: { type: [tierRowSchema], required: true },
    ruleTierMap: { type: Schema.Types.Mixed, default: null },
    celebrationMap: { type: Schema.Types.Mixed, default: null },
    amountThresholds: { type: Schema.Types.Mixed, default: null },
    specialReelTiers: { type: [tierRowSchema], default: null },
    respinRange: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

export const PaytableConfig = model<IPaytableConfig>("PaytableConfig", paytableConfigSchema);
