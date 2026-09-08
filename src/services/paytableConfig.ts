import { PaytableConfig, TierRow, TierKey } from "../models/PaytableConfig";
import { WinTierName } from "../gameTiers";
import { shamrockSpinMeta } from "../games/ShamrockSpin/meta";
import { cashMachineMeta } from "../games/CashMachine/meta";
import { buffalo777Meta } from "../games/Buffalo777/meta";
import { crazy777Meta } from "../games/Crazy777/meta";
import { fiveXRewindMeta } from "../games/FiveXRewind/meta";
import {
  calculateWin,
  NON_COIN_SYMBOLS,
  Symbol as FiveXSymbol,
  DEFAULT_BASE_TIERS as FIVEX_DEFAULT_BASE_TIERS,
  DEFAULT_COMBO_MULTIPLIERS as FIVEX_DEFAULT_COMBO_MULTIPLIERS,
  isGenuineLoss,
  isAny3BarOnly,
  isAny3BarWithSevenBar,
  isAny3Sevens,
} from "../games/FiveXRewind/winCalc";
import { sizzlingSevensMeta } from "../games/SizzlingSevens/meta";
import {
  SizzlingSymbol,
  DEFAULT_PAYTABLE as SIZZLING_DEFAULT_PAYTABLE,
  PURE_WILD_PAYOUT as SIZZLING_PURE_WILD_PAYOUT,
  WILD_SYMBOL as SIZZLING_WILD_SYMBOL,
  REEL_COUNT as SIZZLING_REEL_COUNT,
  ROW_COUNT as SIZZLING_ROW_COUNT,
} from "../games/SizzlingSevens/config";
import {
  Grid as SizzlingGrid,
  Paytable as SizzlingPaytable,
  PureWildPayout as SizzlingPureWildPayout,
  calculateSpinWin as sizzlingCalculateSpinWin,
  triggerFreeGames as sizzlingTriggerFreeGames,
  pickFreeSpinMultiplier as sizzlingPickFreeSpinMultiplier,
} from "../games/SizzlingSevens/winCalc";

const FREQUENCY_TOLERANCE = 0.01;
const RTP_TOLERANCE_PERCENT = 0.5;

export interface PaytableConfigDTO {
  gameId: string;
  targetRtpPercent: number;
  freeSpinsGranted: number | null;
  tiers: TierRow[];
  ruleTierMap: Record<string, string> | null;
  /** Which celebration overlay (if any) each win tier triggers — admin-editable. A tier
   * missing from the map (or mapped to null) just plays the plain win chime. */
  celebrationMap: Partial<Record<TierKey, WinTierName | null>> | null;
  amountThresholds: {
    simpleWinMax: number;
    bigWinMin: number;
    megaWinMin: number;
    jackpotMin: number;
    zeroRespinMin: number;
    zeroRespinMax: number;
  } | null;
  /** Crazy 777 only — a second, fully independent weighted table (reel 4 / the special reel),
   * summing to 100% on its own, separate from `tiers`' 100% sum. */
  specialReelTiers: TierRow[] | null;
  /** Crazy 777 only — bounds for the RESPIN special-reel feature. */
  respinRange: { min: number; max: number } | null;
}

/**
 * Seeded so that, out of the box (before an admin ever saves a change), both games behave
 * the same as they did under the old reel-weight-driven engines — derived via Monte Carlo
 * simulation of the previous buildStrip()/evaluateLine() (ShamrockSpin) and weighted-digit
 * concatenation (Cash Machine) logic. Both defaults reproduce the already-accepted (see
 * ShamrockSpin/config.ts and CashMachine/config.ts history) inflated RTP of the old system —
 * this panel is what finally gives admin a real way to bring that down if they want to.
 */
const DEFAULT_CONFIGS: Record<string, PaytableConfigDTO> = {
  [shamrockSpinMeta.id]: {
    gameId: shamrockSpinMeta.id,
    targetRtpPercent: 330.32,
    freeSpinsGranted: 3,
    tiers: [
      { key: "loss", frequencyPercent: 54.79, payoutMultiplier: null, freeSpinPayoutMultiplier: null },
      { key: "freeSpin", frequencyPercent: 8.0, payoutMultiplier: null, freeSpinPayoutMultiplier: null },
      { key: "simpleWin", frequencyPercent: 34.91, payoutMultiplier: 4.5, freeSpinPayoutMultiplier: 6 },
      { key: "bigWin", frequencyPercent: 1.91, payoutMultiplier: 29, freeSpinPayoutMultiplier: 29 },
      { key: "megaWin", frequencyPercent: 0.37, payoutMultiplier: 59, freeSpinPayoutMultiplier: 59 },
      { key: "jackpot", frequencyPercent: 0.02, payoutMultiplier: 400, freeSpinPayoutMultiplier: 4000 },
    ],
    ruleTierMap: {
      WILD_JACKPOT: "jackpot",
      GREEN_SEVEN: "megaWin",
      ORANGE_SEVEN: "megaWin",
      YELLOW_SEVEN: "bigWin",
      TRIPLE_BAR: "bigWin",
      ANY_SEVENS: "simpleWin",
      ANY_BARS: "simpleWin",
      SINGLE_BAR: "simpleWin",
      TWO_WILDS: "simpleWin",
      ONE_WILD: "simpleWin",
    },
    celebrationMap: { simpleWin: null, bigWin: "BIG WIN", megaWin: "MEGA WIN", jackpot: "JACKPOT" },
    amountThresholds: null,
    specialReelTiers: null,
    respinRange: null,
  },
  [cashMachineMeta.id]: {
    gameId: cashMachineMeta.id,
    // Base tiers (loss/simple/big/mega/jackpot) still sum to ~139.52%, same as before; the
    // extra ~31.5 points come from the new "zeroRespin" tier (3% frequency, revealed value
    // ranges 1-20, estimated avg ~10.5x for this preview — actual payout is whatever value
    // the respin reveals, see games/CashMachine/engine.ts).
    targetRtpPercent: 171.02,
    freeSpinsGranted: null,
    tiers: [
      { key: "loss", frequencyPercent: 53.38, payoutMultiplier: null, freeSpinPayoutMultiplier: null },
      { key: "simpleWin", frequencyPercent: 40.15, payoutMultiplier: 0.68, freeSpinPayoutMultiplier: null },
      { key: "bigWin", frequencyPercent: 3.16, payoutMultiplier: 17.96, freeSpinPayoutMultiplier: null },
      { key: "megaWin", frequencyPercent: 0.3, payoutMultiplier: 144.16, freeSpinPayoutMultiplier: null },
      { key: "jackpot", frequencyPercent: 0.01, payoutMultiplier: 1221.45, freeSpinPayoutMultiplier: null },
      { key: "zeroRespin", frequencyPercent: 3.0, payoutMultiplier: 10.5, freeSpinPayoutMultiplier: null },
    ],
    ruleTierMap: null,
    celebrationMap: { simpleWin: null, bigWin: "BIG WIN", megaWin: "MEGA WIN", jackpot: "JACKPOT", zeroRespin: null },
    amountThresholds: {
      simpleWinMax: 99,
      bigWinMin: 100,
      megaWinMin: 1000,
      jackpotMin: 10000,
      zeroRespinMin: 1,
      zeroRespinMax: 20,
    },
    specialReelTiers: null,
    respinRange: null,
  },
  [buffalo777Meta.id]: {
    gameId: buffalo777Meta.id,
    // No "old engine" to reproduce here (brand new game) — frequencies chosen fresh to land
    // around a realistic ~93% RTP, decreasing roughly geometrically as payout rises. Every
    // tier below maps to exactly one symbol/combo (see engine.ts) so these payouts are the
    // *exact* per-spin amounts, not estimates — matches the reference paytable precisely.
    targetRtpPercent: 92.98,
    freeSpinsGranted: null,
    tiers: [
      { key: "loss", frequencyPercent: 72.6187, payoutMultiplier: null, freeSpinPayoutMultiplier: null },
      { key: "ten", frequencyPercent: 10.0904, payoutMultiplier: 1, freeSpinPayoutMultiplier: null },
      { key: "jack", frequencyPercent: 6.7269, payoutMultiplier: 2, freeSpinPayoutMultiplier: null },
      { key: "queen", frequencyPercent: 4.4846, payoutMultiplier: 3, freeSpinPayoutMultiplier: null },
      { key: "king", frequencyPercent: 2.8029, payoutMultiplier: 4, freeSpinPayoutMultiplier: null },
      { key: "ace", frequencyPercent: 1.5696, payoutMultiplier: 5, freeSpinPayoutMultiplier: null },
      { key: "bull", frequencyPercent: 0.7848, payoutMultiplier: 10, freeSpinPayoutMultiplier: null },
      { key: "anyBar", frequencyPercent: 0.6166, payoutMultiplier: 15, freeSpinPayoutMultiplier: null },
      { key: "singleBar", frequencyPercent: 0.2018, payoutMultiplier: 50, freeSpinPayoutMultiplier: null },
      { key: "doubleBar", frequencyPercent: 0.0729, payoutMultiplier: 75, freeSpinPayoutMultiplier: null },
      { key: "tripleBar", frequencyPercent: 0.0247, payoutMultiplier: 100, freeSpinPayoutMultiplier: null },
      { key: "moneyBag", frequencyPercent: 0.005, payoutMultiplier: 250, freeSpinPayoutMultiplier: null },
      { key: "coin", frequencyPercent: 0.0011, payoutMultiplier: 500, freeSpinPayoutMultiplier: null },
    ],
    ruleTierMap: null,
    celebrationMap: {
      loss: null,
      ten: null,
      jack: null,
      queen: null,
      king: null,
      ace: null,
      bull: null,
      anyBar: null,
      singleBar: "BIG WIN",
      doubleBar: "BIG WIN",
      tripleBar: "MEGA WIN",
      moneyBag: "MEGA WIN",
      coin: "JACKPOT",
    },
    amountThresholds: null,
    specialReelTiers: null,
    respinRange: null,
  },
  [crazy777Meta.id]: {
    gameId: crazy777Meta.id,
    // Brand new game — the admin will tune the real numbers via the RTP panel (confirmed with
    // user), so these defaults just need to be internally consistent (each table sums to 100%,
    // targetRtpPercent matches what computeRtpPercent's joint-EV formula actually computes for
    // them — see scratch simulation this session). Reels 1-3 win on an exact 3-of-a-kind OR a
    // mixed-family combo (anySeven/anyBar/anyGlobal — confirmed against a reference build).
    targetRtpPercent: 342.68,
    freeSpinsGranted: null,
    tiers: [
      { key: "loss", frequencyPercent: 90, payoutMultiplier: null, freeSpinPayoutMultiplier: null },
      { key: "singleBar", frequencyPercent: 2, payoutMultiplier: 15, freeSpinPayoutMultiplier: null },
      { key: "doubleBar", frequencyPercent: 1, payoutMultiplier: 30, freeSpinPayoutMultiplier: null },
      { key: "sevenLow", frequencyPercent: 0.5, payoutMultiplier: 40, freeSpinPayoutMultiplier: null },
      { key: "sevenMid", frequencyPercent: 0.2, payoutMultiplier: 80, freeSpinPayoutMultiplier: null },
      { key: "sevenHigh", frequencyPercent: 0.05, payoutMultiplier: 200, freeSpinPayoutMultiplier: null },
      { key: "anySeven", frequencyPercent: 1, payoutMultiplier: 8, freeSpinPayoutMultiplier: null },
      { key: "anyBar", frequencyPercent: 3, payoutMultiplier: 5, freeSpinPayoutMultiplier: null },
      { key: "anyGlobal", frequencyPercent: 2.25, payoutMultiplier: 2, freeSpinPayoutMultiplier: null },
    ],
    ruleTierMap: null,
    // Keyed off the *special* tier, not the line tier — see games/Crazy777/engine.ts.
    celebrationMap: {
      multiplier2x: null,
      multiplier5x: "BIG WIN",
      multiplier10x: "JACKPOT",
      dollarPlus: null,
      doubleDollarPlus: "MEGA WIN",
      respin: null,
      specialEmpty: null,
    },
    amountThresholds: null,
    specialReelTiers: [
      { key: "multiplier2x", frequencyPercent: 35, payoutMultiplier: 2, freeSpinPayoutMultiplier: null },
      { key: "multiplier5x", frequencyPercent: 12, payoutMultiplier: 5, freeSpinPayoutMultiplier: null },
      { key: "multiplier10x", frequencyPercent: 3, payoutMultiplier: 10, freeSpinPayoutMultiplier: null },
      // payoutMultiplier here is the bet-multiplier bonus added on top of baseWin (confirmed
      // with user: flat multiplier of bet, same style as 2x/5x/10x — not a payout guess).
      { key: "dollarPlus", frequencyPercent: 15, payoutMultiplier: 3, freeSpinPayoutMultiplier: null },
      { key: "doubleDollarPlus", frequencyPercent: 6, payoutMultiplier: 8, freeSpinPayoutMultiplier: null },
      { key: "respin", frequencyPercent: 7, payoutMultiplier: null, freeSpinPayoutMultiplier: null },
      { key: "specialEmpty", frequencyPercent: 22, payoutMultiplier: null, freeSpinPayoutMultiplier: null },
    ],
    respinRange: { min: 1, max: 5 },
  },
  [fiveXRewindMeta.id]: {
    gameId: fiveXRewindMeta.id,
    // `tiers` is a flat line-tier table, one outcome rolled per spin — same pattern as every
    // other game (loss + each named win category, each with its own admin-editable frequency
    // AND payout). See games/FiveXRewind/engine.ts for how each tier's base (pre-coin)
    // symbols get constructed. Frequencies found via numeric search (see scratch simulation
    // this session) to land close to the 90% target.
    targetRtpPercent: 90.0,
    freeSpinsGranted: null,
    tiers: [
      { key: "loss", frequencyPercent: 89.0, payoutMultiplier: null, freeSpinPayoutMultiplier: null },
      { key: "whiteBar", frequencyPercent: 2.0, payoutMultiplier: 1, freeSpinPayoutMultiplier: null },
      { key: "redBar", frequencyPercent: 1.2, payoutMultiplier: 5, freeSpinPayoutMultiplier: null },
      { key: "purpleBar", frequencyPercent: 0.8, payoutMultiplier: 6, freeSpinPayoutMultiplier: null },
      { key: "sevenBar", frequencyPercent: 0.3, payoutMultiplier: 10, freeSpinPayoutMultiplier: null },
      { key: "red7", frequencyPercent: 0.08, payoutMultiplier: 20, freeSpinPayoutMultiplier: null },
      { key: "purple7", frequencyPercent: 0.15, payoutMultiplier: 15, freeSpinPayoutMultiplier: null },
      { key: "blue7", frequencyPercent: 0.25, payoutMultiplier: 12, freeSpinPayoutMultiplier: null },
      { key: "any3BarOnly", frequencyPercent: 3.5, payoutMultiplier: 2, freeSpinPayoutMultiplier: null },
      { key: "any3BarWithSevenBar", frequencyPercent: 1.5, payoutMultiplier: 4, freeSpinPayoutMultiplier: null },
      { key: "any3Sevens", frequencyPercent: 1.22, payoutMultiplier: 8, freeSpinPayoutMultiplier: null },
    ],
    ruleTierMap: null,
    celebrationMap: null,
    // Thresholds here are bet-multiplier cutoffs (not dollar amounts like Cash Machine) —
    // see games/FiveXRewind/engine.ts's celebrationTier(). zeroRespinMin/Max are unused
    // (Cash Machine only).
    amountThresholds: {
      simpleWinMax: 0,
      bigWinMin: 15,
      megaWinMin: 50,
      jackpotMin: 400,
      zeroRespinMin: 0,
      zeroRespinMax: 0,
    },
    // Coin-overlay table (see the TierKey union's comment) — rolled independently for *each*
    // of the 3 reels, deciding whether a coin replaces that reel's line symbol.
    specialReelTiers: [
      { key: "noCoin", frequencyPercent: 97.3662, payoutMultiplier: null, freeSpinPayoutMultiplier: null },
      { key: "coin2x", frequencyPercent: 1.5803, payoutMultiplier: null, freeSpinPayoutMultiplier: null },
      { key: "coin3x", frequencyPercent: 0.7901, payoutMultiplier: null, freeSpinPayoutMultiplier: null },
      { key: "coin4x", frequencyPercent: 0.2195, payoutMultiplier: null, freeSpinPayoutMultiplier: null },
      { key: "coin5x", frequencyPercent: 0.0439, payoutMultiplier: null, freeSpinPayoutMultiplier: null },
    ],
    respinRange: null,
  },
  [sizzlingSevensMeta.id]: {
    gameId: sizzlingSevensMeta.id,
    // `tiers` is a 7-row reel-strip weight table (one row per symbol, not a per-outcome table
    // like every other game — see games/SizzlingSevens/config.ts) — frequencyPercent is that
    // symbol's draw weight (all 7 sum to 100%), payoutMultiplier is its 3-matching payout
    // (WILD_2X's row holds only the 3-Wild pure payout).
    // A 3x3 grid only has 9 cells, and every cell sits on ~9 of the 27 (heavily overlapping)
    // lines at once — with the spec's original payout figures (RED_7=250, 3-Wild=2500, etc.)
    // that redundancy pushed the *minimum achievable* RTP into the thousands of percent no
    // matter how weights were tuned (verified both empirically and via a closed-form
    // 27*sum(p_i^3 * payout_i) derivation this session). To land at a realistic 85% target,
    // every payout below (including the two normally-fixed 1-/2-Wild consolation amounts in
    // config.ts's PURE_WILD_PAYOUT) is scaled down by that same ~88x factor instead — same
    // relative proportions between symbols, just recalibrated for this game's much higher
    // per-spin hit-multiplicity than a typical single-line game.
    targetRtpPercent: 85.0,
    freeSpinsGranted: null,
    tiers: [
      { key: "BAR", frequencyPercent: 29.13, payoutMultiplier: 0.28, freeSpinPayoutMultiplier: null },
      { key: "DOUBLE_BAR", frequencyPercent: 27.4, payoutMultiplier: 0.34, freeSpinPayoutMultiplier: null },
      { key: "TRIPLE_BAR", frequencyPercent: 23.12, payoutMultiplier: 0.57, freeSpinPayoutMultiplier: null },
      { key: "BLUE_7", frequencyPercent: 18.35, payoutMultiplier: 1.14, freeSpinPayoutMultiplier: null },
      { key: "BONUS", frequencyPercent: 1.4, payoutMultiplier: 0.68, freeSpinPayoutMultiplier: null },
      { key: "WILD_2X", frequencyPercent: 0.4, payoutMultiplier: 28.41, freeSpinPayoutMultiplier: null },
      { key: "RED_7", frequencyPercent: 0.2, payoutMultiplier: 2.84, freeSpinPayoutMultiplier: null },
    ],
    ruleTierMap: null,
    celebrationMap: null,
    // Bet-multiple cutoffs — see games/SizzlingSevens/engine.ts's celebrationTier() comment:
    // this ratio is bet-independent (basePayout x wildMultiplier / LINE_COST). With payouts
    // rescaled for the 85% RTP target, the ceiling is now 3-Wild = 28.41 / 30 = ~0.95x, so
    // these cutoffs are scaled down to match — mirrors engine.ts's DEFAULT_THRESHOLDS exactly.
    amountThresholds: {
      simpleWinMax: 0,
      bigWinMin: 0.15,
      megaWinMin: 0.3,
      jackpotMin: 0.7,
      zeroRespinMin: 0,
      zeroRespinMax: 0,
    },
    specialReelTiers: null,
    respinRange: null,
  },
};

function toDTO(doc: {
  gameId: string;
  targetRtpPercent: number;
  freeSpinsGranted: number | null;
  tiers: TierRow[];
  ruleTierMap: Record<string, string> | null;
  celebrationMap?: PaytableConfigDTO["celebrationMap"];
  amountThresholds: PaytableConfigDTO["amountThresholds"];
  specialReelTiers?: PaytableConfigDTO["specialReelTiers"];
  respinRange?: PaytableConfigDTO["respinRange"];
}): PaytableConfigDTO {
  return {
    gameId: doc.gameId,
    targetRtpPercent: doc.targetRtpPercent,
    freeSpinsGranted: doc.freeSpinsGranted,
    tiers: doc.tiers,
    ruleTierMap: doc.ruleTierMap,
    // Saved documents created before this feature won't have the field at all.
    celebrationMap: doc.celebrationMap ?? null,
    amountThresholds: doc.amountThresholds,
    specialReelTiers: doc.specialReelTiers ?? null,
    respinRange: doc.respinRange ?? null,
  };
}

export function getDefaultPaytableConfig(gameId: string): PaytableConfigDTO {
  const def = DEFAULT_CONFIGS[gameId];
  if (!def) throw new Error(`No default paytable config for game "${gameId}"`);
  return toDTO(def);
}

export async function getPaytableConfig(gameId: string): Promise<PaytableConfigDTO> {
  const doc = await PaytableConfig.findOne({ gameId }).lean();
  if (!doc) return getDefaultPaytableConfig(gameId);
  return toDTO(doc);
}

/**
 * RTP = sum over win-tiers of (frequency% / 100 * payoutMultiplier), plus — if a "freeSpin"
 * row exists — the expected value of the bonus round it triggers: freeSpin frequency *
 * average spins granted * the same win-tier sum, evaluated with freeSpinPayoutMultiplier
 * instead. Assumes the same tier frequencies apply during a free-spin bonus round as on a
 * base spin (only the payout column differs) — a deliberate simplification, see plan.
 */
/** Crazy 777 only — final win per unit bet for one (line tier, special tier) combination.
 * Multiplier special tiers scale baseWin; dollar-bonus special tiers add a flat bet-scaled
 * amount on top; RESPIN (and any other tier) passes baseWin through unchanged for *this*
 * spin — its extra value is folded in separately below as a first-order retrigger term.
 * specialEmpty never actually pays out as itself — see engine.ts's resolveSpin — a line win
 * always resolves it into a weighted-random pick among the other real special tiers, so its
 * RTP contribution is that same frequency-weighted average, not zero. */
function crazy777FinalWinPerBet(lineTier: TierRow, specialTier: TierRow, specialTiers: TierRow[]): number {
  if (lineTier.key === "loss" || lineTier.payoutMultiplier === null) return 0;
  const baseWin = lineTier.payoutMultiplier;

  if (specialTier.key === "specialEmpty") {
    const realTiers = specialTiers.filter((t) => t.key !== "specialEmpty");
    const realTotal = realTiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
    if (realTotal === 0) return baseWin;
    return realTiers.reduce(
      (sum, t) => sum + (t.frequencyPercent / realTotal) * crazy777FinalWinPerBet(lineTier, t, specialTiers),
      0
    );
  }

  switch (specialTier.key) {
    case "multiplier2x":
    case "multiplier5x":
    case "multiplier10x":
      return baseWin * (specialTier.payoutMultiplier ?? 1);
    case "dollarPlus":
    case "doubleDollarPlus":
      return baseWin + (specialTier.payoutMultiplier ?? 0);
    default:
      return baseWin;
  }
}

/**
 * Crazy 777 has two fully independent weighted tables (line tiers × special-reel tiers), so
 * RTP is the *exact* joint EV over every combination (cheap — a handful of rows each way),
 * plus a first-order term for RESPIN's retrigger value: P(line win) × P(special=RESPIN) ×
 * average respins granted × the same joint EV (treating each awarded respin as worth another
 * full spin's EV — same style of simplification ShamrockSpin's free-spin EV term already uses).
 */
function computeCrazy777RtpPercent(config: PaytableConfigDTO): number {
  const specialTiers = config.specialReelTiers ?? [];
  let jointEV = 0;
  for (const line of config.tiers) {
    for (const special of specialTiers) {
      jointEV +=
        (line.frequencyPercent / 100) * (special.frequencyPercent / 100) * crazy777FinalWinPerBet(line, special, specialTiers);
    }
  }

  const pLineWin =
    config.tiers.filter((t) => t.key !== "loss" && t.payoutMultiplier !== null).reduce((sum, t) => sum + t.frequencyPercent, 0) /
    100;
  const respinTier = specialTiers.find((t) => t.key === "respin");
  const specialEmptyTier = specialTiers.find((t) => t.key === "specialEmpty");
  const realTiers = specialTiers.filter((t) => t.key !== "specialEmpty");
  const realTotal = realTiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  // A line win can reach RESPIN two ways: rolling it directly, or rolling specialEmpty and
  // having its weighted-random reveal land on respin — see crazy777FinalWinPerBet.
  const pRespinDirect = respinTier ? respinTier.frequencyPercent / 100 : 0;
  const pRespinViaReveal =
    specialEmptyTier && respinTier && realTotal > 0
      ? (specialEmptyTier.frequencyPercent / 100) * (respinTier.frequencyPercent / realTotal)
      : 0;
  const pRespin = pRespinDirect + pRespinViaReveal;
  const range = config.respinRange ?? { min: 0, max: 0 };
  const avgRespins = (range.min + range.max) / 2;
  const extraRtp = pLineWin * pRespin * avgRespins * jointEV;

  return (jointEV + extraRtp) * 100;
}

/** Maps each of 5x Rewind's line-tier TierKeys to its exact-match Symbol — only the 7 tiers
 * that resolve to a single, specific symbol (the 4 "mixed" categories and "loss" instead
 * enumerate every structurally-matching combo, see fiveXLineCombos). Duplicated from
 * games/FiveXRewind/engine.ts's equivalent map since engine.ts itself imports
 * PaytableConfigDTO from this file, so importing engine.ts back here would cycle. */
const FIVEX_EXACT_TIER_TO_SYMBOL: Partial<Record<TierKey, FiveXSymbol>> = {
  whiteBar: "WHITE_BAR",
  sevenBar: "SEVEN_BAR",
  redBar: "RED_BAR",
  purpleBar: "PURPLE_BAR",
  red7: "RED_7",
  purple7: "PURPLE_7",
  blue7: "BLUE_7",
};

const FIVEX_COIN_TIER_TO_SYMBOL: Partial<Record<TierKey, FiveXSymbol>> = {
  coin2x: "COIN_2X",
  coin3x: "COIN_3X",
  coin4x: "COIN_4X",
  coin5x: "COIN_5X",
};

/** Every base (pre-coin) 3-symbol combo that structurally belongs to a given line tier,
 * uniformly weighted within it — a single combo for the 7 exact-match tiers, every
 * structurally-matching combo (from the 7-symbol non-coin alphabet) for "loss" and the 3
 * "mixed" categories. Mirrors exactly what engine.ts's rejection sampler can produce. */
function fiveXLineCombos(tierKey: TierKey): [FiveXSymbol, FiveXSymbol, FiveXSymbol][] {
  const exactSymbol = FIVEX_EXACT_TIER_TO_SYMBOL[tierKey];
  if (exactSymbol) return [[exactSymbol, exactSymbol, exactSymbol]];

  const predicate =
    tierKey === "loss"
      ? isGenuineLoss
      : tierKey === "any3BarOnly"
        ? isAny3BarOnly
        : tierKey === "any3BarWithSevenBar"
          ? isAny3BarWithSevenBar
          : tierKey === "any3Sevens"
            ? isAny3Sevens
            : null;
  if (!predicate) return [];

  const combos: [FiveXSymbol, FiveXSymbol, FiveXSymbol][] = [];
  for (const s1 of NON_COIN_SYMBOLS) {
    for (const s2 of NON_COIN_SYMBOLS) {
      for (const s3 of NON_COIN_SYMBOLS) {
        if (predicate(s1, s2, s3)) combos.push([s1, s2, s3]);
      }
    }
  }
  return combos;
}

/**
 * 5x Rewind rolls one line tier per spin (loss + each named win category, exactly like every
 * other game's `tiers`), then independently rolls the coin-overlay table (`specialReelTiers`,
 * reused from Crazy 777's schema but consumed 3 times — once per reel, not once per spin —
 * see engine.ts) to decide whether a coin replaces each reel's line symbol. RTP is the exact
 * EV: for each line tier, every one of its structurally-valid base combos (uniformly likely
 * within that tier) × every one of the 5×5×5 = 125 coin-overlay combinations, evaluated
 * through the same calculateWin used by real spins.
 */
function computeFiveXRewindRtpPercent(config: PaytableConfigDTO): number {
  const baseTiers: Partial<Record<FiveXSymbol, number>> = { ...FIVEX_DEFAULT_BASE_TIERS };
  for (const tier of config.tiers) {
    const symbol = FIVEX_EXACT_TIER_TO_SYMBOL[tier.key];
    if (symbol && tier.payoutMultiplier !== null) baseTiers[symbol] = tier.payoutMultiplier;
  }
  const comboMultipliers = {
    anyBarOnly: config.tiers.find((t) => t.key === "any3BarOnly")?.payoutMultiplier ?? FIVEX_DEFAULT_COMBO_MULTIPLIERS.anyBarOnly,
    anyBarWithSevenBar:
      config.tiers.find((t) => t.key === "any3BarWithSevenBar")?.payoutMultiplier ?? FIVEX_DEFAULT_COMBO_MULTIPLIERS.anyBarWithSevenBar,
    anySevens: config.tiers.find((t) => t.key === "any3Sevens")?.payoutMultiplier ?? FIVEX_DEFAULT_COMBO_MULTIPLIERS.anySevens,
  };

  const coinTiers = config.specialReelTiers ?? [];
  const coinProb: (number | null)[] = []; // index 0 = "no coin" (null symbol), 1-4 = the 4 coin values
  const coinSymbol: (FiveXSymbol | null)[] = [null];
  const noCoinTier = coinTiers.find((t) => t.key === "noCoin");
  coinProb.push((noCoinTier?.frequencyPercent ?? 0) / 100);
  for (const [key, symbol] of Object.entries(FIVEX_COIN_TIER_TO_SYMBOL) as [TierKey, FiveXSymbol][]) {
    coinSymbol.push(symbol);
    coinProb.push((coinTiers.find((t) => t.key === key)?.frequencyPercent ?? 0) / 100);
  }

  let ev = 0;
  for (const tier of config.tiers) {
    const combos = fiveXLineCombos(tier.key);
    if (combos.length === 0) continue;
    const pCombo = (tier.frequencyPercent / 100) / combos.length;
    if (pCombo === 0) continue;

    for (const [b1, b2, b3] of combos) {
      for (let i1 = 0; i1 < coinProb.length; i1++) {
        if (coinProb[i1] === 0) continue;
        for (let i2 = 0; i2 < coinProb.length; i2++) {
          if (coinProb[i2] === 0) continue;
          for (let i3 = 0; i3 < coinProb.length; i3++) {
            if (coinProb[i3] === 0) continue;
            const reels: [FiveXSymbol, FiveXSymbol, FiveXSymbol] = [
              coinSymbol[i1] ?? b1,
              coinSymbol[i2] ?? b2,
              coinSymbol[i3] ?? b3,
            ];
            const p = pCombo * coinProb[i1]! * coinProb[i2]! * coinProb[i3]!;
            ev += p * calculateWin(reels, 1, baseTiers, comboMultipliers).payout;
          }
        }
      }
    }
  }

  return ev * 100;
}

/** Deterministic seeded PRNG (mulberry32) — Sizzling 7s' RTP can't be exactly enumerated (5
 * reels x 3 rows x 27 overlapping lines x Wild/Bonus/Free-Games is combinatorially far too
 * large), so it's estimated via Monte Carlo simulation instead. A *seeded* generator keeps
 * that estimate a pure, repeatable function of the config — the same tiers always produce the
 * same computed RTP, so the admin panel's validation never flickers between page loads. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sizzlingWeightedSymbol(tiers: TierRow[], rng: () => number): SizzlingSymbol {
  const total = tiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  let roll = rng() * total;
  for (const t of tiers) {
    roll -= t.frequencyPercent;
    if (roll < 0) return t.key as SizzlingSymbol;
  }
  return tiers[tiers.length - 1].key as SizzlingSymbol;
}

function sizzlingDrawGrid(tiers: TierRow[], rng: () => number): SizzlingGrid {
  const grid: SizzlingGrid = [];
  for (let reel = 0; reel < SIZZLING_REEL_COUNT; reel++) {
    const column: SizzlingSymbol[] = [];
    for (let row = 0; row < SIZZLING_ROW_COUNT; row++) column.push(sizzlingWeightedSymbol(tiers, rng));
    grid.push(column);
  }
  return grid;
}

function sizzlingPaytableFrom(tiers: TierRow[]): SizzlingPaytable {
  const paytable: SizzlingPaytable = { ...SIZZLING_DEFAULT_PAYTABLE };
  for (const tier of tiers) {
    if (tier.key === SIZZLING_WILD_SYMBOL || tier.payoutMultiplier === null) continue;
    if (tier.key in paytable) (paytable as Record<string, number>)[tier.key] = tier.payoutMultiplier;
  }
  return paytable;
}

function sizzlingPureWildPayoutFrom(tiers: TierRow[]): SizzlingPureWildPayout {
  const wildRow = tiers.find((t) => t.key === SIZZLING_WILD_SYMBOL);
  return {
    1: SIZZLING_PURE_WILD_PAYOUT[1],
    2: SIZZLING_PURE_WILD_PAYOUT[2],
    3: wildRow?.payoutMultiplier ?? SIZZLING_PURE_WILD_PAYOUT[3],
  };
}

const SIZZLING_SIMS = 200_000;
/** Safety cap on total free spins played within one triggered chain (initial award + every
 * retrigger) — astronomically unlikely to ever bind for real weights, just bounds worst case. */
const SIZZLING_MAX_FREE_SPINS = 500;

/** Plays out one full round at a 1-unit bet: a base spin, plus — if it triggers — every free
 * spin in the awarded (and possibly retriggered) Free Games chain. Reuses the exact same
 * calculateSpinWin/triggerFreeGames/pickFreeSpinMultiplier the real engine uses, so this can
 * only diverge from live play in *how many* rounds get sampled, never in the win math itself.
 * `isBaseLoss` reflects only the base spin itself (what the player immediately sees) — a
 * round that triggers Free Games always has scatterWin > 0, so it's never counted as a loss
 * here even though bonus-round wins are folded into `win`. */
function simulateSizzlingRound(
  tiers: TierRow[],
  paytable: SizzlingPaytable,
  pureWildPayout: SizzlingPureWildPayout,
  rng: () => number
): { win: number; isBaseLoss: boolean } {
  const betMultiplier = 1;
  const grid = sizzlingDrawGrid(tiers, rng);
  const evaluation = sizzlingCalculateSpinWin(grid, paytable, betMultiplier, 1, pureWildPayout);
  let total = evaluation.finalWin;
  const isBaseLoss = evaluation.finalWin === 0;

  if (evaluation.triggeredFreeGames) {
    let award = sizzlingTriggerFreeGames(rng);
    let remaining = award.freeSpins;
    let pool = award.multiplierPool;
    let played = 0;
    while (remaining > 0 && played < SIZZLING_MAX_FREE_SPINS) {
      remaining--;
      played++;
      const freeGrid = sizzlingDrawGrid(tiers, rng);
      const freeMultiplier = sizzlingPickFreeSpinMultiplier(pool, rng);
      const freeEvaluation = sizzlingCalculateSpinWin(freeGrid, paytable, betMultiplier, freeMultiplier, pureWildPayout);
      total += freeEvaluation.finalWin;
      if (freeEvaluation.triggeredFreeGames) {
        award = sizzlingTriggerFreeGames(rng);
        remaining += award.freeSpins;
        pool = award.multiplierPool;
      }
    }
  }

  return { win: total, isBaseLoss };
}

export interface SizzlingSevensStats {
  rtpPercent: number;
  /** Percent of base spins (not counting free-spin rounds) that pay nothing at all — the
   * closest equivalent to every other game's admin-editable "Loss" row, except this is a
   * *computed* stat rather than an editable weight, since Sizzling 7s has no dedicated "loss"
   * symbol to draw — losing is just whatever combinatorially doesn't line up. */
  lossPercent: number;
}

/** Sizzling 7s' RTP and loss frequency are estimated (not exactly enumerated, unlike every
 * other game here) via SIZZLING_SIMS simulated rounds at a 1-unit bet, using a fixed-seed RNG
 * so the result is a deterministic function of `config` alone. Both stats come from the same
 * simulation pass so they're always consistent with each other. */
export function computeSizzlingSevensStats(config: PaytableConfigDTO): SizzlingSevensStats {
  const paytable = sizzlingPaytableFrom(config.tiers);
  const pureWildPayout = sizzlingPureWildPayoutFrom(config.tiers);
  const rng = mulberry32(0xc0ffee);

  let total = 0;
  let lossCount = 0;
  for (let i = 0; i < SIZZLING_SIMS; i++) {
    const { win, isBaseLoss } = simulateSizzlingRound(config.tiers, paytable, pureWildPayout, rng);
    total += win;
    if (isBaseLoss) lossCount++;
  }
  return {
    rtpPercent: (total / SIZZLING_SIMS) * 100,
    lossPercent: (lossCount / SIZZLING_SIMS) * 100,
  };
}

function computeSizzlingSevensRtpPercent(config: PaytableConfigDTO): number {
  return computeSizzlingSevensStats(config).rtpPercent;
}

export function computeRtpPercent(config: PaytableConfigDTO): number {
  if (config.gameId === fiveXRewindMeta.id) {
    return computeFiveXRewindRtpPercent(config);
  }

  if (config.gameId === sizzlingSevensMeta.id) {
    return computeSizzlingSevensRtpPercent(config);
  }

  if (config.specialReelTiers) {
    return computeCrazy777RtpPercent(config);
  }

  const winTiers = config.tiers.filter((t) => t.payoutMultiplier !== null);
  const baseRtp = winTiers.reduce((sum, t) => sum + (t.frequencyPercent / 100) * (t.payoutMultiplier ?? 0), 0);

  const freeSpinRow = config.tiers.find((t) => t.key === "freeSpin");
  if (!freeSpinRow || !config.freeSpinsGranted) {
    return baseRtp * 100;
  }

  const freeSpinTierSum = winTiers.reduce(
    (sum, t) => sum + (t.frequencyPercent / 100) * (t.freeSpinPayoutMultiplier ?? t.payoutMultiplier ?? 0),
    0
  );
  const freeSpinRtp = (freeSpinRow.frequencyPercent / 100) * config.freeSpinsGranted * freeSpinTierSum;

  return (baseRtp + freeSpinRtp) * 100;
}

export interface ValidationResult {
  valid: boolean;
  computedRtpPercent: number;
  frequencySum: number;
  errors: string[];
}

export function validatePaytableConfig(config: PaytableConfigDTO): ValidationResult {
  const errors: string[] = [];
  const frequencySum = config.tiers.reduce((sum, t) => sum + t.frequencyPercent, 0);

  if (Math.abs(frequencySum - 100) > FREQUENCY_TOLERANCE) {
    errors.push(`Frequencies must sum to 100% — currently ${frequencySum.toFixed(2)}%.`);
  }

  const computedRtpPercent = computeRtpPercent(config);
  if (Math.abs(computedRtpPercent - config.targetRtpPercent) > RTP_TOLERANCE_PERCENT) {
    errors.push(
      `Computed RTP is ${computedRtpPercent.toFixed(2)}%, which doesn't match the target of ${config.targetRtpPercent.toFixed(2)}% (±${RTP_TOLERANCE_PERCENT}%). Adjust frequencies or payout multipliers.`
    );
  }

  for (const tier of config.tiers) {
    if (tier.frequencyPercent < 0 || tier.frequencyPercent > 100) {
      errors.push(`"${tier.key}" frequency must be between 0 and 100.`);
    }
    if (tier.payoutMultiplier !== null && tier.payoutMultiplier < 0) {
      errors.push(`"${tier.key}" payout multiplier can't be negative.`);
    }
  }

  if (config.amountThresholds) {
    const { zeroRespinMin, zeroRespinMax } = config.amountThresholds;
    if (zeroRespinMin < 0 || zeroRespinMax < 0) {
      errors.push(`Zero Respin's revealed-value range can't be negative.`);
    } else if (zeroRespinMin > zeroRespinMax) {
      errors.push(`Zero Respin's minimum revealed value must be less than or equal to its maximum.`);
    }
  }

  if (config.specialReelTiers) {
    const specialFrequencySum = config.specialReelTiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
    if (Math.abs(specialFrequencySum - 100) > FREQUENCY_TOLERANCE) {
      errors.push(`Special reel frequencies must sum to 100% — currently ${specialFrequencySum.toFixed(2)}%.`);
    }
    for (const tier of config.specialReelTiers) {
      if (tier.frequencyPercent < 0 || tier.frequencyPercent > 100) {
        errors.push(`"${tier.key}" special reel frequency must be between 0 and 100.`);
      }
      if (tier.payoutMultiplier !== null && tier.payoutMultiplier < 0) {
        errors.push(`"${tier.key}" special reel payout multiplier can't be negative.`);
      }
    }
  }

  if (config.respinRange) {
    const { min, max } = config.respinRange;
    if (min < 0 || max < 0) {
      errors.push(`Respin count range can't be negative.`);
    } else if (min > max) {
      errors.push(`Respin minimum must be less than or equal to its maximum.`);
    }
  }

  return { valid: errors.length === 0, computedRtpPercent, frequencySum, errors };
}

export async function savePaytableConfig(config: PaytableConfigDTO): Promise<PaytableConfigDTO> {
  const doc = await PaytableConfig.findOneAndUpdate(
    { gameId: config.gameId },
    {
      $set: {
        targetRtpPercent: config.targetRtpPercent,
        freeSpinsGranted: config.freeSpinsGranted,
        tiers: config.tiers,
        ruleTierMap: config.ruleTierMap,
        celebrationMap: config.celebrationMap,
        amountThresholds: config.amountThresholds,
        specialReelTiers: config.specialReelTiers,
        respinRange: config.respinRange,
      },
    },
    { upsert: true, new: true }
  ).lean();
  return toDTO(doc!);
}
