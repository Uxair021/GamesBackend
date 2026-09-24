import { PaytableConfig, TierRow, TierKey } from "../models/PaytableConfig";
import { WinTierName } from "../gameTiers";
import { shamrockSpinMeta } from "../games/ShamrockSpin/meta";
import { cashMachineMeta } from "../games/CashMachine/meta";
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
import { crystalCloverMeta } from "../games/CrystalClover/meta";
import { fruity777Meta } from "../games/Fruity777/meta";
import { mega10xPayMeta } from "../games/Mega10XPay/meta";
import { vegasHitsMeta } from "../games/VegasHits/meta";
import {
  VegasHitsSymbol,
  DEFAULT_PAYTABLE as VEGASHITS_DEFAULT_PAYTABLE,
  DEFAULT_WILD_RULES as VEGASHITS_DEFAULT_WILD_RULES,
  WILD_SYMBOL as VEGASHITS_WILD_SYMBOL,
  BONUS_SYMBOL as VEGASHITS_BONUS_SYMBOL,
  REEL_COUNT as VEGASHITS_REEL_COUNT,
  ROW_COUNT as VEGASHITS_ROW_COUNT,
  LINE_COST as VEGASHITS_LINE_COST,
  MAX_TOTAL_FREE_SPINS as VEGASHITS_MAX_TOTAL_FREE_SPINS,
} from "../games/VegasHits/config";
import {
  Grid as VegasHitsGrid,
  Paytable as VegasHitsPaytable,
  WildRules as VegasHitsWildRules,
  calculateSpinWin as vegasHitsCalculateSpinWin,
  triggerFreeGames as vegasHitsTriggerFreeGames,
  pickChiliMultiplier as vegasHitsPickChiliMultiplier,
} from "../games/VegasHits/winCalc";
import { rubberDuckMeta } from "../games/RubberDuck/meta";
import {
  PAYING_SYMBOLS as RD_PAYING_SYMBOLS,
  DEFAULT_PAYOUTS as RD_DEFAULT_PAYOUTS,
  DEFAULT_WEIGHTS as RD_DEFAULT_WEIGHTS,
  BONUS_SYMBOL as RD_BONUS_SYMBOL,
  REEL_COUNT as RD_REEL_COUNT,
  FREE_SPIN_TRIGGER_COUNT as RD_FREE_SPIN_TRIGGER_COUNT,
  FREE_SPINS_BASE as RD_FREE_SPINS_BASE,
  FREE_SPINS_RETRIGGER as RD_FREE_SPINS_RETRIGGER,
  FREE_SPIN_WIN_MULTIPLIER as RD_FREE_SPIN_WIN_MULTIPLIER,
} from "../games/RubberDuck/config";
import { topDollarMeta } from "../games/TopDollar/meta";
import { OFFER_DRAW_COUNT_WEIGHTS, MIN_BET as TD_MIN_BET } from "../games/TopDollar/config";
import { gemsDeluxeMeta } from "../games/GemsDeluxe/meta";
import { OFFER_DRAW_COUNT_WEIGHTS as GD_OFFER_DRAW_COUNT_WEIGHTS, MIN_BET as GD_MIN_BET } from "../games/GemsDeluxe/config";

const FREQUENCY_TOLERANCE = 0.01;
const RTP_TOLERANCE_PERCENT = 0.5;

export interface PaytableConfigDTO {
  gameId: string;
  targetRtpPercent: number;
  /** Sizzling 7s and Crystal Clover only — see models/PaytableConfig.ts's
   * IPaytableConfig.targetLossPercent. null for every other game. */
  targetLossPercent: number | null;
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
  /** Crystal Clover and Vegas Hits only — see models/PaytableConfig.ts's
   * IPaytableConfig.reelStateConfig. */
  reelStateConfig: { centerRowChancePercent: number } | null;
  /** Vegas Hits only — see models/PaytableConfig.ts's IPaytableConfig.wildRules. */
  wildRules: VegasHitsWildRules | null;
  /** Life of Luxury only — see models/PaytableConfig.ts's IPaytableConfig.symbolPayouts. */
  symbolPayouts: Record<string, { x3: number; x4: number; x5: number }> | null;
  /** Life of Luxury only — see models/PaytableConfig.ts's IPaytableConfig.scatterRules. */
  scatterRules: { chancePercent: number; x3: number; x4: number; x5: number; freeSpinsAwarded: number } | null;
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
    targetLossPercent: null,
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
    reelStateConfig: null,
    wildRules: null,
    symbolPayouts: null,
    scatterRules: null,
  },
  [cashMachineMeta.id]: {
    gameId: cashMachineMeta.id,
    // Base tiers (loss/simple/big/mega/jackpot) still sum to ~139.52%, same as before; the
    // extra ~31.5 points come from the new "zeroRespin" tier (3% frequency, revealed value
    // ranges 1-20, estimated avg ~10.5x for this preview — actual payout is whatever value
    // the respin reveals, see games/CashMachine/engine.ts).
    targetRtpPercent: 171.02,
    targetLossPercent: null,
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
    reelStateConfig: null,
    wildRules: null,
    symbolPayouts: null,
    scatterRules: null,
  },
  [crazy777Meta.id]: {
    gameId: crazy777Meta.id,
    // Brand new game — the admin will tune the real numbers via the RTP panel (confirmed with
    // user), so these defaults just need to be internally consistent (each table sums to 100%,
    // targetRtpPercent matches what computeRtpPercent's joint-EV formula actually computes for
    // them — see scratch simulation this session). Reels 1-3 win on an exact 3-of-a-kind OR a
    // mixed-family combo (anySeven/anyBar/anyGlobal — confirmed against a reference build).
    targetRtpPercent: 342.68,
    targetLossPercent: null,
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
    reelStateConfig: null,
    wildRules: null,
    symbolPayouts: null,
    scatterRules: null,
  },
  [fiveXRewindMeta.id]: {
    gameId: fiveXRewindMeta.id,
    // `tiers` is a flat line-tier table, one outcome rolled per spin — same pattern as every
    // other game (loss + each named win category, each with its own admin-editable frequency
    // AND payout). See games/FiveXRewind/engine.ts for how each tier's base (pre-coin)
    // symbols get constructed. Frequencies found via numeric search (see scratch simulation
    // this session) to land close to the 90% target.
    targetRtpPercent: 90.0,
    targetLossPercent: null,
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
    reelStateConfig: null,
    wildRules: null,
    symbolPayouts: null,
    scatterRules: null,
  },
  [crystalCloverMeta.id]: {
    gameId: crystalCloverMeta.id,
    // Outcome-first, same shape as ShamrockSpin (see games/CrystalClover/engine.ts's doc
    // comment) — `tiers` is loss + 4 win buckets, summing to 100%, RTP = plain
    // Σ(freq%/100 × payoutMultiplier), exactly the generic formula every other "has a loss row"
    // game already uses (no simulation needed, unlike the old per-cell-weight model this
    // replaced). `ruleTierMap` picks which of the 8 WIN_RULE_IDs cosmetically renders within a
    // tier — purely decorative, doesn't affect payout. MULTIPLIER_2X is a second, independent
    // roll (`specialReelTiers`, mirrors Crazy 777's reel 4): baseRTP × E[multiplier effect]
    // (specialEmpty=×1, multiplier2x=×2, multiplier4x=×4, multiplier8x=×8) is the full RTP —
    // see computeCrystalCloverRtpPercent. Frequencies/payouts below solved to land at ~90%.
    // NOTE: computeCrystalCloverRtpPercent is now only a LOWER BOUND on the true realized RTP —
    // since the grid can incidentally satisfy lines beyond the designated one (see
    // games/CrystalClover/engine.ts's doc comment), every spin's *actual* payout can run a bit
    // above this closed-form estimate. Accepted trade-off, confirmed with user, rather than
    // building a full simulation-based estimator for this game too.
    targetRtpPercent: 90.0,
    targetLossPercent: null,
    freeSpinsGranted: null,
    tiers: [
      { key: "loss", frequencyPercent: 45, payoutMultiplier: null, freeSpinPayoutMultiplier: null },
      { key: "simpleWin", frequencyPercent: 48, payoutMultiplier: 0.5284, freeSpinPayoutMultiplier: null },
      { key: "bigWin", frequencyPercent: 5, payoutMultiplier: 3.1704, freeSpinPayoutMultiplier: null },
      { key: "megaWin", frequencyPercent: 1.5, payoutMultiplier: 10.5681, freeSpinPayoutMultiplier: null },
      { key: "jackpot", frequencyPercent: 0.5, payoutMultiplier: 52.8405, freeSpinPayoutMultiplier: null },
    ],
    ruleTierMap: {
      SEVEN_CLOVER: "bigWin",
      TRIPLE_BAR: "simpleWin",
      DOUBLE_BAR: "simpleWin",
      BAR: "simpleWin",
      ANY_BAR: "simpleWin",
      ONE_WILD: "simpleWin",
      TWO_WILD: "megaWin",
      THREE_WILD: "jackpot",
    },
    celebrationMap: { simpleWin: null, bigWin: "BIG WIN", megaWin: "MEGA WIN", jackpot: "JACKPOT" },
    amountThresholds: null,
    // MULTIPLIER_2X's independent roll (see this entry's doc comment) — sums to 100% on its
    // own. payoutMultiplier is the ×N actually credited; MULTIPLIER_COPY_COUNT in engine.ts
    // pairs each row 1:1 with how many MULTIPLIER_2X symbols cosmetically render.
    specialReelTiers: [
      { key: "specialEmpty", frequencyPercent: 95, payoutMultiplier: 1, freeSpinPayoutMultiplier: null },
      { key: "multiplier2x", frequencyPercent: 4, payoutMultiplier: 2, freeSpinPayoutMultiplier: null },
      { key: "multiplier4x", frequencyPercent: 0.8, payoutMultiplier: 4, freeSpinPayoutMultiplier: null },
      { key: "multiplier8x", frequencyPercent: 0.2, payoutMultiplier: 8, freeSpinPayoutMultiplier: null },
    ],
    respinRange: null,
    // Chance a reel not forced by the designated win line lands 1-symbol-center vs.
    // 2-symbols-top+bottom (see engine.ts's buildGrid) — 50/50 out of the box.
    reelStateConfig: { centerRowChancePercent: 50 },
    wildRules: null,
    symbolPayouts: null,
    scatterRules: null,
  },
  [fruity777Meta.id]: {
    gameId: fruity777Meta.id,
    // Brand new game — frequencies for apple..star are copied 1:1 from Buffalo 777's already-
    // validated shape (both use the exact same 1/2/3/4/5/10/15/50/75/100/250 payout ladder), with
    // a small "freeSpin" slice (0.03%) carved out of loss for the new Bonus feature (3 BONUS ->
    // 3-10 free spins, see games/Fruity777/config.ts's MIN/MAX_FREE_SPINS — that range itself is
    // NOT admin-tunable, confirmed with user; freeSpinsGranted below is only its RTP-preview
    // average). freeSpinPayoutMultiplier == payoutMultiplier for every tier (confirmed with user:
    // free spins pay the same paytable, no boost).
    targetRtpPercent: 92.61,
    targetLossPercent: null,
    freeSpinsGranted: 6.5,
    tiers: [
      { key: "loss", frequencyPercent: 72.5898, payoutMultiplier: null, freeSpinPayoutMultiplier: null },
      { key: "freeSpin", frequencyPercent: 0.03, payoutMultiplier: null, freeSpinPayoutMultiplier: null },
      { key: "apple", frequencyPercent: 10.0904, payoutMultiplier: 1, freeSpinPayoutMultiplier: 1 },
      { key: "lemon", frequencyPercent: 6.7269, payoutMultiplier: 2, freeSpinPayoutMultiplier: 2 },
      { key: "orange", frequencyPercent: 4.4846, payoutMultiplier: 3, freeSpinPayoutMultiplier: 3 },
      { key: "peach", frequencyPercent: 2.8029, payoutMultiplier: 4, freeSpinPayoutMultiplier: 4 },
      { key: "pineapple", frequencyPercent: 1.5696, payoutMultiplier: 5, freeSpinPayoutMultiplier: 5 },
      { key: "grape", frequencyPercent: 0.7848, payoutMultiplier: 10, freeSpinPayoutMultiplier: 10 },
      { key: "watermelon", frequencyPercent: 0.6166, payoutMultiplier: 15, freeSpinPayoutMultiplier: 15 },
      { key: "dragonFruit", frequencyPercent: 0.2018, payoutMultiplier: 50, freeSpinPayoutMultiplier: 50 },
      { key: "seven", frequencyPercent: 0.0729, payoutMultiplier: 75, freeSpinPayoutMultiplier: 75 },
      { key: "bar", frequencyPercent: 0.0247, payoutMultiplier: 100, freeSpinPayoutMultiplier: 100 },
      { key: "star", frequencyPercent: 0.005, payoutMultiplier: 250, freeSpinPayoutMultiplier: 250 },
    ],
    ruleTierMap: null,
    celebrationMap: {
      loss: null,
      freeSpin: null,
      apple: null,
      lemon: null,
      orange: null,
      peach: null,
      pineapple: null,
      grape: null,
      watermelon: "BIG WIN",
      dragonFruit: "BIG WIN",
      seven: "BIG WIN",
      bar: "MEGA WIN",
      star: "JACKPOT",
    },
    amountThresholds: null,
    specialReelTiers: null,
    respinRange: null,
    reelStateConfig: null,
    wildRules: null,
    symbolPayouts: null,
    scatterRules: null,
  },
  [mega10xPayMeta.id]: {
    gameId: mega10xPayMeta.id,
    // Brand new game — frequencies solved so each tier's own (freq/100 * payout) contribution
    // sums to exactly 90% RTP (see plan/scratch working this session), with the two flagship
    // TEN_X/THREE_X tiers kept extremely rare given their 5000x/2000x payouts. No free spins,
    // no special reel table — this is a plain outcome-first game like Buffalo 777.
    targetRtpPercent: 90.0,
    targetLossPercent: null,
    freeSpinsGranted: null,
    tiers: [
      { key: "loss", frequencyPercent: 87.4381, payoutMultiplier: null, freeSpinPayoutMultiplier: null },
      { key: "oneCherry", frequencyPercent: 1.5, payoutMultiplier: 10, freeSpinPayoutMultiplier: null },
      { key: "twoCherry", frequencyPercent: 2.5, payoutMultiplier: 2, freeSpinPayoutMultiplier: null },
      { key: "cherry", frequencyPercent: 0.125, payoutMultiplier: 64, freeSpinPayoutMultiplier: null },
      { key: "singleBar", frequencyPercent: 2.5, payoutMultiplier: 4, freeSpinPayoutMultiplier: null },
      { key: "doubleBar", frequencyPercent: 1.333, payoutMultiplier: 6, freeSpinPayoutMultiplier: null },
      { key: "tripleBar", frequencyPercent: 0.75, payoutMultiplier: 8, freeSpinPayoutMultiplier: null },
      { key: "sevenBar", frequencyPercent: 0.5, payoutMultiplier: 10, freeSpinPayoutMultiplier: null },
      { key: "seven", frequencyPercent: 0.2667, payoutMultiplier: 15, freeSpinPayoutMultiplier: null },
      { key: "any3BarFamilyMix", frequencyPercent: 1.333, payoutMultiplier: 6, freeSpinPayoutMultiplier: null },
      { key: "any3SingleBarSevenBar", frequencyPercent: 1.25, payoutMultiplier: 4, freeSpinPayoutMultiplier: null },
      { key: "any3SevenSevenBar", frequencyPercent: 0.5, payoutMultiplier: 8, freeSpinPayoutMultiplier: null },
      { key: "threeX", frequencyPercent: 0.003, payoutMultiplier: 2000, freeSpinPayoutMultiplier: null },
      { key: "tenX", frequencyPercent: 0.0012, payoutMultiplier: 5000, freeSpinPayoutMultiplier: null },
    ],
    ruleTierMap: null,
    celebrationMap: {
      loss: null,
      tenX: "JACKPOT",
      threeX: "JACKPOT",
      cherry: "MEGA WIN",
      seven: "BIG WIN",
      sevenBar: "BIG WIN",
      oneCherry: "BIG WIN",
      tripleBar: "BIG WIN",
      any3SevenSevenBar: "BIG WIN",
      doubleBar: null,
      any3BarFamilyMix: null,
      singleBar: null,
      any3SingleBarSevenBar: null,
      twoCherry: null,
    },
    amountThresholds: null,
    specialReelTiers: null,
    respinRange: null,
    reelStateConfig: null,
    wildRules: null,
    symbolPayouts: null,
    scatterRules: null,
  },
  [vegasHitsMeta.id]: {
    gameId: vegasHitsMeta.id,
    // Reel-strip weight table (one row per symbol) — same shape as Sizzling 7s (see
    // games/VegasHits/config.ts's LINE_COST comment): a real grid with a Wild line multiplier,
    // overlapping paylines, and (see reelStateConfig below) a 2-state reel shape needs
    // simulation to know its RTP, not the plain outcome-first formula most other games use (see
    // computeVegasHitsStats below). Only 3 of the 8 possible per-spin reel-state combinations
    // ever leave any payline live at all, which floors achievable RTP far below target at the
    // spec's originally-requested payout scale no matter how these weights are shaped — see
    // config.ts's DEFAULT_PAYTABLE comment for why the payouts themselves are scaled up ~10.28x
    // instead. These weights are a hand-picked baseline (targeted search this session, confirmed
    // by simulation) landing at ~85% RTP at that payout scale.
    targetRtpPercent: 85.0,
    // Matches this weighting's own simulated loss% (see computeVegasHitsStats) — same "no
    // dedicated loss row, so the admin-editable target starts at whatever these weights already
    // produce" pattern Sizzling 7s uses.
    targetLossPercent: 94.64,
    freeSpinsGranted: null,
    tiers: [
      { key: "GREEN_7", frequencyPercent: 32, payoutMultiplier: 205.6, freeSpinPayoutMultiplier: null },
      { key: "DOUBLE_GREEN_7", frequencyPercent: 13, payoutMultiplier: 514, freeSpinPayoutMultiplier: null },
      { key: "TRIPLE_GREEN_7", frequencyPercent: 2.5, payoutMultiplier: 1028, freeSpinPayoutMultiplier: null },
      { key: "RED_7", frequencyPercent: 22, payoutMultiplier: 123.36, freeSpinPayoutMultiplier: null },
      { key: "BLUE_7", frequencyPercent: 20, payoutMultiplier: 154.2, freeSpinPayoutMultiplier: null },
      // WILD (RED HOT 3X) never pays directly — only its line multiplier applies — and BONUS
      // pays a fixed 1X total bet, not admin-tunable (see config.ts's
      // SCATTER_PAYOUT_MULTIPLE_OF_BET) — both rows' payoutMultiplier is unused.
      { key: "WILD", frequencyPercent: 4.5, payoutMultiplier: null, freeSpinPayoutMultiplier: null },
      { key: "BONUS", frequencyPercent: 6, payoutMultiplier: null, freeSpinPayoutMultiplier: null },
    ],
    ruleTierMap: null,
    celebrationMap: null,
    // Bet-multiple cutoffs — see games/VegasHits/engine.ts's DEFAULT_THRESHOLDS comment (picked
    // from the simulated non-zero win distribution at these weights/payouts/wildRules:
    // bigWinMin≈p97, megaWinMin≈p99.5, jackpotMin≈p99.9).
    amountThresholds: {
      simpleWinMax: 0,
      bigWinMin: 15,
      megaWinMin: 35,
      jackpotMin: 70,
      zeroRespinMin: 0,
      zeroRespinMax: 0,
    },
    specialReelTiers: null,
    respinRange: null,
    // Chance a reel lands 1-symbol-center vs. 2-symbols-top+bottom (see games/VegasHits/
    // engine.ts's rollReelState) — 50/50 out of the box, same as 7 Crystal Clover's default.
    reelStateConfig: { centerRowChancePercent: 50 },
    // The wild's own payout rules (see games/VegasHits/config.ts's WildRules doc comment) — the
    // spec's originally-requested numbers (2/6/500/3/6/3), with the 4 flat bet-amount fields
    // scaled down the same ~0.235x as DEFAULT_PAYTABLE (see that constant's comment for why);
    // oneCompleteMultiplier/twoCompleteMultiplier are dimensionless ratios, kept at the spec's
    // literal 3/6.
    wildRules: {
      onePureBet: 0.47 * 30,
      twoPureBet: 1.41 * 30,
      threePureBet: 117.5 * 30,
      oneCompleteMultiplier: 3,
      twoCompleteMultiplier: 6,
      anyMixBet: 0.705 * 30,
    },
    symbolPayouts: null,
    scatterRules: null,
  },
  [rubberDuckMeta.id]: {
    gameId: rubberDuckMeta.id,
    // Reel-strip weight table — 21 rows (14 payers + BONUS + 6 loss fruits), summing to 100%,
    // same shape as Life of Luxury/Vegas Hits. Unlike those games every row's payoutMultiplier
    // IS used directly (see computeRubberDuckRtpPercent below): a flat per-hit value, no
    // 3/4/5-of-a-kind tiers, since a symbol pays for itself on any single reel with no matching
    // needed (confirmed with user). Weights solved this session (see config.ts's DEFAULT_WEIGHTS
    // doc comment) so the 14 payers alone land base RTP at ~78% and the BONUS free-spins feature
    // (3+ of 5 reels, 15 spins, +10 more on a retrigger mid-round, 3x wins throughout) contributes
    // the remaining ~7%, for the requested 85% total.
    targetRtpPercent: 85.0,
    targetLossPercent: null,
    freeSpinsGranted: RD_FREE_SPINS_BASE,
    tiers: (Object.keys(RD_DEFAULT_WEIGHTS) as (keyof typeof RD_DEFAULT_WEIGHTS)[]).map((key) => {
      const payout = (RD_DEFAULT_PAYOUTS as Record<string, number | undefined>)[key] ?? null;
      return {
        key: key as TierKey,
        frequencyPercent: RD_DEFAULT_WEIGHTS[key],
        payoutMultiplier: payout,
        freeSpinPayoutMultiplier: payout !== null ? payout * RD_FREE_SPIN_WIN_MULTIPLIER : null,
      };
    }),
    ruleTierMap: null,
    celebrationMap: null,
    // Bet-multiple cutoffs — mirrors games/RubberDuck/engine.ts's DEFAULT_THRESHOLDS exactly (see
    // that constant's doc comment for why each bucket lands where it does).
    amountThresholds: {
      simpleWinMax: 0,
      bigWinMin: 250,
      megaWinMin: 3000,
      jackpotMin: 8000,
      zeroRespinMin: 0,
      zeroRespinMax: 0,
    },
    specialReelTiers: null,
    respinRange: null,
    reelStateConfig: null,
    wildRules: null,
    symbolPayouts: null,
    scatterRules: null,
  },
  [topDollarMeta.id]: {
    gameId: topDollarMeta.id,
    // Outcome-first (one row per named win condition, not per reel symbol) — same "roll the
    // tier, then build 3 reels to match" shape as Buffalo 777/Crazy 777 (see
    // games/TopDollar/engine.ts). A reel-strip-independent weighting (each reel rolls its own
    // symbol) was tried first and rejected: Diamond pays for just 1 occurrence, so no weighting
    // across only 6 always-landing symbols avoided a many-hundred-percent RTP (confirmed by
    // exact enumeration this session — 914% on the first pass). Losses need no blank/filler
    // symbol here either — one of the 3 reels lands physically between two symbols instead of
    // cleanly on one (a "half-stop", see games/TopDollar/pixi/Reel.ts's spinTo), which alone
    // guarantees no tier can accidentally read as a win regardless of what the other two reels
    // show. Solved (see this session's scratch calc) to land ~81-90% RTP across the 4 bet
    // levels despite the bonus round's flat (non-bet-scaled) payouts pulling the effective RTP
    // higher at the min bet than the max — targetRtpPercent below is the value at MIN_BET.
    //
    // TEMPORARY (per user request, "for now"): dollarBonus bumped way up from its balanced
    // 2.9% to 20% purely so the bonus round is easy to trigger while testing — this pushes
    // real RTP well over 100% (roughly 148% at bet 10). Dial dollarBonus back down (and loss
    // back up to keep the tiers summing to 100) before this goes anywhere near real money.
    targetRtpPercent: 90.24,
    targetLossPercent: null,
    freeSpinsGranted: null,
    tiers: [
      { key: "loss", frequencyPercent: 74.155, payoutMultiplier: null, freeSpinPayoutMultiplier: null },
      { key: "seven", frequencyPercent: 0.1, payoutMultiplier: 100, freeSpinPayoutMultiplier: null },
      { key: "tripleBar", frequencyPercent: 0.135, payoutMultiplier: 75, freeSpinPayoutMultiplier: null },
      { key: "doubleBar", frequencyPercent: 0.2, payoutMultiplier: 50, freeSpinPayoutMultiplier: null },
      { key: "singleBar", frequencyPercent: 0.41, payoutMultiplier: 25, freeSpinPayoutMultiplier: null },
      { key: "anyBar", frequencyPercent: 1.0, payoutMultiplier: 10, freeSpinPayoutMultiplier: null },
      { key: "diamondThree", frequencyPercent: 0.5, payoutMultiplier: 20, freeSpinPayoutMultiplier: null },
      { key: "diamondTwo", frequencyPercent: 1.0, payoutMultiplier: 10, freeSpinPayoutMultiplier: null },
      { key: "diamondOne", frequencyPercent: 2.5, payoutMultiplier: 4, freeSpinPayoutMultiplier: null },
      // Landing this rolls DOLLAR onto reel 3 and hands off to the bonus round instead of
      // paying a line amount directly (payoutMultiplier unused — see specialReelTiers below).
      { key: "dollarBonus", frequencyPercent: 20, payoutMultiplier: null, freeSpinPayoutMultiplier: null },
    ],
    ruleTierMap: null,
    celebrationMap: null,
    // Confirmed with user: no JACKPOT/MEGA WIN/BIG WIN celebration overlay for this game at
    // all, ever — every win (base or bonus) is just a plain credited amount.
    amountThresholds: null,
    // The bonus round's note-bundle value pool — a second, fully independent weighted table
    // (see models/PaytableConfig.ts's specialReelTiers doc comment on this game). Each row's
    // payoutMultiplier is a FLAT dollar amount, not a bet multiple — engine.ts sums 1-3
    // weighted draws from this table per Take-It/Try-Again offer. $1000 is deliberately very
    // rare (confirmed with user: "the rarest") — pool mean ≈18.9, and each offer averages
    // ~1.8 draws (see config.ts's OFFER_DRAW_COUNT_WEIGHTS), for an average offer of ~$34.
    specialReelTiers: [
      { key: "dollarPoolFive", frequencyPercent: 40, payoutMultiplier: 5, freeSpinPayoutMultiplier: null },
      { key: "dollarPoolTen", frequencyPercent: 30, payoutMultiplier: 10, freeSpinPayoutMultiplier: null },
      { key: "dollarPoolTwenty", frequencyPercent: 15, payoutMultiplier: 20, freeSpinPayoutMultiplier: null },
      { key: "dollarPoolFifty", frequencyPercent: 10, payoutMultiplier: 50, freeSpinPayoutMultiplier: null },
      { key: "dollarPoolHundred", frequencyPercent: 4.9, payoutMultiplier: 100, freeSpinPayoutMultiplier: null },
      { key: "dollarPoolThousand", frequencyPercent: 0.1, payoutMultiplier: 1000, freeSpinPayoutMultiplier: null },
    ],
    respinRange: null,
    reelStateConfig: null,
    wildRules: null,
    symbolPayouts: null,
    scatterRules: null,
  },
  // Gems Deluxe is a duplicate of Top Dollar under a new name/id — identical mechanics, tiers,
  // and bonus pool (see games/GemsDeluxe/engine.ts, a straight copy of games/TopDollar/engine.ts).
  [gemsDeluxeMeta.id]: {
    gameId: gemsDeluxeMeta.id,
    targetRtpPercent: 90.24,
    targetLossPercent: null,
    freeSpinsGranted: null,
    tiers: [
      { key: "loss", frequencyPercent: 74.155, payoutMultiplier: null, freeSpinPayoutMultiplier: null },
      { key: "seven", frequencyPercent: 0.1, payoutMultiplier: 100, freeSpinPayoutMultiplier: null },
      { key: "tripleBar", frequencyPercent: 0.135, payoutMultiplier: 75, freeSpinPayoutMultiplier: null },
      { key: "doubleBar", frequencyPercent: 0.2, payoutMultiplier: 50, freeSpinPayoutMultiplier: null },
      { key: "singleBar", frequencyPercent: 0.41, payoutMultiplier: 25, freeSpinPayoutMultiplier: null },
      { key: "anyBar", frequencyPercent: 1.0, payoutMultiplier: 10, freeSpinPayoutMultiplier: null },
      { key: "diamondThree", frequencyPercent: 0.5, payoutMultiplier: 20, freeSpinPayoutMultiplier: null },
      { key: "diamondTwo", frequencyPercent: 1.0, payoutMultiplier: 10, freeSpinPayoutMultiplier: null },
      { key: "diamondOne", frequencyPercent: 2.5, payoutMultiplier: 4, freeSpinPayoutMultiplier: null },
      // Landing this rolls DOLLAR onto reel 3 and hands off to the bonus round instead of
      // paying a line amount directly (payoutMultiplier unused — see specialReelTiers below).
      { key: "dollarBonus", frequencyPercent: 20, payoutMultiplier: null, freeSpinPayoutMultiplier: null },
    ],
    ruleTierMap: null,
    celebrationMap: null,
    amountThresholds: null,
    specialReelTiers: [
      { key: "dollarPoolFive", frequencyPercent: 40, payoutMultiplier: 5, freeSpinPayoutMultiplier: null },
      { key: "dollarPoolTen", frequencyPercent: 30, payoutMultiplier: 10, freeSpinPayoutMultiplier: null },
      { key: "dollarPoolTwenty", frequencyPercent: 15, payoutMultiplier: 20, freeSpinPayoutMultiplier: null },
      { key: "dollarPoolFifty", frequencyPercent: 10, payoutMultiplier: 50, freeSpinPayoutMultiplier: null },
      { key: "dollarPoolHundred", frequencyPercent: 4.9, payoutMultiplier: 100, freeSpinPayoutMultiplier: null },
      { key: "dollarPoolThousand", frequencyPercent: 0.1, payoutMultiplier: 1000, freeSpinPayoutMultiplier: null },
    ],
    respinRange: null,
    reelStateConfig: null,
    wildRules: null,
    symbolPayouts: null,
    scatterRules: null,
  },
};

function toDTO(doc: {
  gameId: string;
  targetRtpPercent: number;
  targetLossPercent?: number | null;
  freeSpinsGranted: number | null;
  tiers: TierRow[];
  ruleTierMap: Record<string, string> | null;
  celebrationMap?: PaytableConfigDTO["celebrationMap"];
  amountThresholds: PaytableConfigDTO["amountThresholds"];
  specialReelTiers?: PaytableConfigDTO["specialReelTiers"];
  respinRange?: PaytableConfigDTO["respinRange"];
  reelStateConfig?: PaytableConfigDTO["reelStateConfig"];
  wildRules?: PaytableConfigDTO["wildRules"];
  symbolPayouts?: PaytableConfigDTO["symbolPayouts"];
  scatterRules?: PaytableConfigDTO["scatterRules"];
}): PaytableConfigDTO {
  return {
    gameId: doc.gameId,
    targetRtpPercent: doc.targetRtpPercent,
    // Saved documents created before this feature won't have the field at all.
    targetLossPercent: doc.targetLossPercent ?? null,
    freeSpinsGranted: doc.freeSpinsGranted,
    tiers: doc.tiers,
    ruleTierMap: doc.ruleTierMap,
    celebrationMap: doc.celebrationMap ?? null,
    amountThresholds: doc.amountThresholds,
    specialReelTiers: doc.specialReelTiers ?? null,
    respinRange: doc.respinRange ?? null,
    reelStateConfig: doc.reelStateConfig ?? null,
    wildRules: doc.wildRules ?? null,
    symbolPayouts: doc.symbolPayouts ?? null,
    scatterRules: doc.scatterRules ?? null,
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


function vegasHitsWeightedSymbol(tiers: TierRow[], rng: () => number): VegasHitsSymbol {
  const total = tiers.reduce((sum, t) => sum + t.frequencyPercent, 0);
  let roll = rng() * total;
  for (const t of tiers) {
    roll -= t.frequencyPercent;
    if (roll < 0) return t.key as VegasHitsSymbol;
  }
  return tiers[tiers.length - 1].key as VegasHitsSymbol;
}

/** Mirrors games/VegasHits/engine.ts's rollReelState exactly — each reel independently shows
 * either 1 symbol on the middle row (CENTER) or 2 on the top+bottom rows (TOP_BOTTOM), never
 * all 3 (see winCalc.ts's Grid type doc comment). */
function vegasHitsDrawGrid(tiers: TierRow[], centerRowChancePercent: number, rng: () => number): VegasHitsGrid {
  const grid: VegasHitsGrid = [];
  for (let reel = 0; reel < VEGASHITS_REEL_COUNT; reel++) {
    const column: (VegasHitsSymbol | null)[] = new Array(VEGASHITS_ROW_COUNT).fill(null);
    if (rng() * 100 < centerRowChancePercent) {
      column[1] = vegasHitsWeightedSymbol(tiers, rng);
    } else {
      column[0] = vegasHitsWeightedSymbol(tiers, rng);
      column[2] = vegasHitsWeightedSymbol(tiers, rng);
    }
    grid.push(column);
  }
  return grid;
}

function vegasHitsPaytableFrom(tiers: TierRow[]): VegasHitsPaytable {
  const paytable: VegasHitsPaytable = { ...VEGASHITS_DEFAULT_PAYTABLE };
  for (const tier of tiers) {
    if (tier.key === VEGASHITS_WILD_SYMBOL || tier.key === VEGASHITS_BONUS_SYMBOL || tier.payoutMultiplier === null) continue;
    if (tier.key in paytable) (paytable as Record<string, number>)[tier.key] = tier.payoutMultiplier;
  }
  return paytable;
}

/** The admin-configured wild rules (see config.ts's WildRules doc comment), falling back to the
 * built-in defaults if unset. */
function vegasHitsWildRulesFrom(config: PaytableConfigDTO): VegasHitsWildRules {
  return config.wildRules ?? VEGASHITS_DEFAULT_WILD_RULES;
}

const VEGASHITS_SIMS = 200_000;
/** Same safety cap as the real engine's spec-defined lifetime cap (see config.ts's
 * MAX_TOTAL_FREE_SPINS) — astronomically unlikely to ever bind for real weights. */
const VEGASHITS_MAX_SIM_FREE_SPINS = VEGASHITS_MAX_TOTAL_FREE_SPINS;

/** Plays out one full round at a 1-unit bet: a base spin, plus — if it triggers — every free
 * spin in the awarded (and possibly retriggered) Free Games chain. Reuses the exact same
 * calculateSpinWin/triggerFreeGames/pickChiliMultiplier the real engine uses, so this can only
 * diverge from live play in *how many* rounds get sampled, never in the win math itself.
 * `isBaseLoss` reflects only the base spin itself (what the player immediately sees) — a round
 * that triggers Free Games always has scatterWin > 0, so it's never counted as a loss here even
 * though bonus-round wins are folded into `win`. */
function simulateVegasHitsRound(
  tiers: TierRow[],
  paytable: VegasHitsPaytable,
  wildRules: VegasHitsWildRules,
  centerRowChancePercent: number,
  rng: () => number
): { win: number; isBaseLoss: boolean } {
  // A real spin's finalWin scales with betMultiplier = totalBet / LINE_COST (see
  // games/VegasHits/routes.ts) — simulating "at a 1-unit bet" means betMultiplier = 1/LINE_COST
  // (and totalBet = 1, for the scatter win's own flat 1X-total-bet rule), not passing 1 for both.
  const betMultiplier = 1 / VEGASHITS_LINE_COST;
  const totalBet = 1;
  const grid = vegasHitsDrawGrid(tiers, centerRowChancePercent, rng);
  const evaluation = vegasHitsCalculateSpinWin(grid, paytable, wildRules, betMultiplier, totalBet, 1);
  let total = evaluation.finalWin;
  const isBaseLoss = evaluation.finalWin === 0;

  if (evaluation.triggeredFreeGames) {
    let remaining = vegasHitsTriggerFreeGames().freeSpins;
    let totalAwarded = remaining;
    let played = 0;
    while (remaining > 0 && played < VEGASHITS_MAX_SIM_FREE_SPINS) {
      remaining--;
      played++;
      const freeGrid = vegasHitsDrawGrid(tiers, centerRowChancePercent, rng);
      const chiliMultiplier = vegasHitsPickChiliMultiplier(rng);
      const freeEvaluation = vegasHitsCalculateSpinWin(freeGrid, paytable, wildRules, betMultiplier, totalBet, chiliMultiplier);
      total += freeEvaluation.finalWin;
      if (freeEvaluation.triggeredFreeGames) {
        const award = vegasHitsTriggerFreeGames();
        if (totalAwarded + award.freeSpins <= VEGASHITS_MAX_TOTAL_FREE_SPINS) {
          remaining += award.freeSpins;
          totalAwarded += award.freeSpins;
        }
      }
    }
  }

  return { win: total, isBaseLoss };
}

export interface VegasHitsStats {
  rtpPercent: number;
  lossPercent: number;
}

/** Vegas Hits' RTP and loss frequency are estimated (not exactly enumerated — same reason as
 * Sizzling 7s: a real grid, overlapping paylines, a Wild line multiplier, and a Free Games
 * chain are combinatorially far too large) via VEGASHITS_SIMS simulated rounds at a 1-unit bet,
 * using a fixed-seed RNG so the result is a deterministic function of `config` alone. */
export function computeVegasHitsStats(config: PaytableConfigDTO): VegasHitsStats {
  const paytable = vegasHitsPaytableFrom(config.tiers);
  const wildRules = vegasHitsWildRulesFrom(config);
  const centerRowChancePercent = config.reelStateConfig?.centerRowChancePercent ?? 50;
  const rng = mulberry32(0xc0ffee);

  let total = 0;
  let lossCount = 0;
  for (let i = 0; i < VEGASHITS_SIMS; i++) {
    const { win, isBaseLoss } = simulateVegasHitsRound(config.tiers, paytable, wildRules, centerRowChancePercent, rng);
    total += win;
    if (isBaseLoss) lossCount++;
  }
  return {
    rtpPercent: (total / VEGASHITS_SIMS) * 100,
    lossPercent: (lossCount / VEGASHITS_SIMS) * 100,
  };
}

function computeVegasHitsRtpPercent(config: PaytableConfigDTO): number {
  return computeVegasHitsStats(config).rtpPercent;
}

/** 7 Crystal Clover is outcome-first (see games/CrystalClover/engine.ts's doc comment) — one
 * discrete tier rolled from `tiers` (loss/simpleWin/bigWin/megaWin/jackpot), then an independent
 * MULTIPLIER_2X roll from `specialReelTiers` applied as a flat multiplier on top. Both are plain
 * weighted rolls over admin-set frequencies/payouts, so unlike Sizzling 7s (no dedicated loss
 * row, RTP only estimable via simulation), this is exact closed-form arithmetic — no simulation
 * needed: RTP = baseRTP × E[multiplier effect]. */
function computeCrystalCloverRtpPercent(config: PaytableConfigDTO): number {
  const baseRtp = config.tiers.reduce((sum, t) => sum + (t.frequencyPercent / 100) * (t.payoutMultiplier ?? 0), 0);
  const specialTiers = config.specialReelTiers ?? [];
  const multiplierEV = specialTiers.reduce((sum, t) => sum + (t.frequencyPercent / 100) * (t.payoutMultiplier ?? 1), 0) || 1;
  return baseRtp * multiplierEV * 100;
}

function nChooseK(n: number, k: number): number {
  let result = 1;
  for (let i = 0; i < k; i++) result = (result * (n - i)) / (i + 1);
  return result;
}

/**
 * Closed-form, not simulated. Each of the 5 reels independently draws from `tiers` (21 rows: 14
 * payers + BONUS + 6 loss fruits) — no matching/adjacency requirement, every reel that lands a
 * paying symbol adds its own payoutMultiplier to the spin's total (confirmed with user: "even a
 * one symbol hit the win... if more then one then win will be adding all the points"). So:
 *
 *   perReelEV = Σ over the 14 payers of (weight_s/100 * payout_s)
 *   baseRtp   = REEL_COUNT * perReelEV        — reels are independent, so this is exact, not an
 *                                                 approximation (no rejection sampling involved)
 *
 * BONUS contributes no direct cash — 3+ of the 5 reels showing it (probability via the Binomial
 * tail, exact) triggers FREE_SPINS_BASE free spins, each paying FREE_SPIN_WIN_MULTIPLIER×. A
 * free spin can itself retrigger (+FREE_SPINS_RETRIGGER more, added to what's left — see
 * games/RubberDuck/routes.ts) — the expected extra spins from that chain is a first-order
 * approximation (mirrors Crazy 777's RESPIN extraRtp term): with `pTrig` this small by
 * construction (rare BONUS weight), higher-order retrigger-of-a-retrigger chains are negligible.
 */
function computeRubberDuckRtpPercent(config: PaytableConfigDTO): number {
  const weightOf = (symbol: string): number => config.tiers.find((t) => t.key === symbol)?.frequencyPercent ?? 0;
  const payoutOf = (symbol: string): number =>
    config.tiers.find((t) => t.key === symbol)?.payoutMultiplier ??
    (RD_DEFAULT_PAYOUTS as Record<string, number | undefined>)[symbol] ??
    0;

  const perReelEV = RD_PAYING_SYMBOLS.reduce((sum, symbol) => sum + (weightOf(symbol) / 100) * payoutOf(symbol), 0);
  const baseRtp = RD_REEL_COUNT * perReelEV;

  const pBonus = weightOf(RD_BONUS_SYMBOL) / 100;
  let pTrig = 0;
  for (let k = RD_FREE_SPIN_TRIGGER_COUNT; k <= RD_REEL_COUNT; k++) {
    pTrig += nChooseK(RD_REEL_COUNT, k) * Math.pow(pBonus, k) * Math.pow(1 - pBonus, RD_REEL_COUNT - k);
  }

  const avgFreeSpins = RD_FREE_SPINS_BASE * (1 + pTrig * RD_FREE_SPINS_RETRIGGER);
  const freeSpinRtp = pTrig * avgFreeSpins * (RD_FREE_SPIN_WIN_MULTIPLIER * baseRtp);

  return (baseRtp + freeSpinRtp) * 100;
}

/**
 * Outcome-first (same "roll the tier, then build reels to match" shape as Buffalo 777/Crazy
 * 777 — see games/TopDollar/engine.ts), so the base-line part is just the plain generic
 * formula every such game already uses: Σ(frequency% × payoutMultiplier). The bonus round's
 * contribution needs its own term because it isn't a bet-multiple: each of the 4 sequential
 * offers is an i.i.d. draw from the same pool (sum of 1-3 weighted draws from
 * `specialReelTiers` — see engine.ts's generateOffer), so E[whichever offer the player ends up
 * accepting] always equals E[a single offer] regardless of their own Take-It/Try-Again
 * strategy (a fixed-horizon optional-stopping argument — stopping earlier or later can't bias
 * the expectation when every draw comes from the same distribution). That expectation is a
 * FLAT dollar amount (confirmed with user, unlike every other number in this game), so —
 * unlike every other game here — this game's realized RTP genuinely varies by bet size; this
 * function reports it at MIN_BET (the reference `targetRtpPercent` is meant to track).
 */
function computeTopDollarRtpPercent(config: PaytableConfigDTO): number {
  const lineEV = config.tiers.reduce(
    (sum, t) => sum + (t.payoutMultiplier !== null ? (t.frequencyPercent / 100) * t.payoutMultiplier : 0),
    0
  );

  const bonusTier = config.tiers.find((t) => t.key === "dollarBonus");
  const bonusProb = (bonusTier?.frequencyPercent ?? 0) / 100;

  const pool = config.specialReelTiers ?? [];
  const poolTotal = pool.reduce((sum, t) => sum + t.frequencyPercent, 0);
  const poolMean = poolTotal > 0 ? pool.reduce((sum, t) => sum + (t.frequencyPercent / poolTotal) * (t.payoutMultiplier ?? 0), 0) : 0;
  const drawCountTotal = OFFER_DRAW_COUNT_WEIGHTS.reduce((sum, w) => sum + w.weight, 0);
  const eDrawCount = drawCountTotal > 0 ? OFFER_DRAW_COUNT_WEIGHTS.reduce((sum, w) => sum + (w.weight / drawCountTotal) * w.count, 0) : 0;
  const eOffer = eDrawCount * poolMean;

  const referenceBet = TD_MIN_BET;
  const bonusRtp = referenceBet > 0 ? (bonusProb * eOffer) / referenceBet : 0;

  return (lineEV + bonusRtp) * 100;
}

/** Gems Deluxe only — a duplicate of Top Dollar under a new name/id, identical mechanics, so
 * this mirrors computeTopDollarRtpPercent above exactly (see its doc comment for the
 * derivation), just reading from GemsDeluxe's own OFFER_DRAW_COUNT_WEIGHTS/MIN_BET. */
function computeGemsDeluxeRtpPercent(config: PaytableConfigDTO): number {
  const lineEV = config.tiers.reduce(
    (sum, t) => sum + (t.payoutMultiplier !== null ? (t.frequencyPercent / 100) * t.payoutMultiplier : 0),
    0
  );

  const bonusTier = config.tiers.find((t) => t.key === "dollarBonus");
  const bonusProb = (bonusTier?.frequencyPercent ?? 0) / 100;

  const pool = config.specialReelTiers ?? [];
  const poolTotal = pool.reduce((sum, t) => sum + t.frequencyPercent, 0);
  const poolMean = poolTotal > 0 ? pool.reduce((sum, t) => sum + (t.frequencyPercent / poolTotal) * (t.payoutMultiplier ?? 0), 0) : 0;
  const drawCountTotal = GD_OFFER_DRAW_COUNT_WEIGHTS.reduce((sum, w) => sum + w.weight, 0);
  const eDrawCount = drawCountTotal > 0 ? GD_OFFER_DRAW_COUNT_WEIGHTS.reduce((sum, w) => sum + (w.weight / drawCountTotal) * w.count, 0) : 0;
  const eOffer = eDrawCount * poolMean;

  const referenceBet = GD_MIN_BET;
  const bonusRtp = referenceBet > 0 ? (bonusProb * eOffer) / referenceBet : 0;

  return (lineEV + bonusRtp) * 100;
}

export function computeRtpPercent(config: PaytableConfigDTO): number {
  if (config.gameId === rubberDuckMeta.id) {
    return computeRubberDuckRtpPercent(config);
  }

  if (config.gameId === topDollarMeta.id) {
    return computeTopDollarRtpPercent(config);
  }

  if (config.gameId === gemsDeluxeMeta.id) {
    return computeGemsDeluxeRtpPercent(config);
  }

  if (config.gameId === fiveXRewindMeta.id) {
    return computeFiveXRewindRtpPercent(config);
  }

  if (config.gameId === crystalCloverMeta.id) {
    return computeCrystalCloverRtpPercent(config);
  }

  if (config.gameId === vegasHitsMeta.id) {
    return computeVegasHitsRtpPercent(config);
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

  if (config.reelStateConfig) {
    const { centerRowChancePercent } = config.reelStateConfig;
    if (centerRowChancePercent < 0 || centerRowChancePercent > 100) {
      errors.push(`Center-row chance must be between 0 and 100.`);
    }
  }

  if (config.wildRules) {
    const { onePureBet, twoPureBet, threePureBet, oneCompleteMultiplier, twoCompleteMultiplier, anyMixBet } = config.wildRules;
    if ([onePureBet, twoPureBet, threePureBet, oneCompleteMultiplier, twoCompleteMultiplier, anyMixBet].some((v) => v < 0)) {
      errors.push("Wild rule values must be 0 or greater.");
    }
  }

  if (config.symbolPayouts) {
    for (const [symbol, row] of Object.entries(config.symbolPayouts)) {
      if (row.x3 < 0 || row.x4 < 0 || row.x5 < 0) {
        errors.push(`"${symbol}" symbol payouts must be 0 or greater.`);
      }
    }
  }

  if (config.scatterRules) {
    const { chancePercent, x3, x4, x5, freeSpinsAwarded } = config.scatterRules;
    if ([x3, x4, x5, freeSpinsAwarded].some((v) => v < 0)) {
      errors.push("Scatter rule values must be 0 or greater.");
    }
    if (chancePercent < 0 || chancePercent > 100) {
      errors.push("Scatter chance % must be between 0 and 100.");
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
        targetLossPercent: config.targetLossPercent,
        freeSpinsGranted: config.freeSpinsGranted,
        tiers: config.tiers,
        ruleTierMap: config.ruleTierMap,
        celebrationMap: config.celebrationMap,
        amountThresholds: config.amountThresholds,
        specialReelTiers: config.specialReelTiers,
        respinRange: config.respinRange,
        reelStateConfig: config.reelStateConfig,
        wildRules: config.wildRules,
        symbolPayouts: config.symbolPayouts,
        scatterRules: config.scatterRules,
      },
    },
    { upsert: true, new: true }
  ).lean();
  return toDTO(doc!);
}
