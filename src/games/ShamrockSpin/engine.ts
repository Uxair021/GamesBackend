import { secureRandomInt } from "../../utils/rng";
import { WILD_SYMBOLS, SEVEN_SYMBOLS, BAR_SYMBOLS, DISPLAY_SYMBOLS, WinRuleId, Symbol } from "./config";
import { WinTierName } from "./winTiers";
import { PaytableConfigDTO } from "../../services/paytableConfig";
import { TierKey, TierRow } from "../../models/PaytableConfig";

export interface ReelResult {
  /** Symbols visible on this reel, top -> middle -> bottom. Middle is the payline. */
  symbols: [Symbol, Symbol, Symbol];
  stopIndex: number;
}

export interface SpinResult {
  reels: [ReelResult, ReelResult, ReelResult];
  lineSymbols: [Symbol, Symbol, Symbol];
  winRuleId: WinRuleId | null;
  /** Multiplier actually credited (the admin-configured tier payout, not the rule's own paytable value). */
  multiplier: number;
  winAmount: number;
  tier: WinTierName | null;
  /** Free spins newly awarded on this line. */
  freeSpinsAwarded: number;
}

/** Fallback used whenever the admin hasn't set (or saved before this feature existed) a
 * celebration for a given tier — see getCelebration(). */
const DEFAULT_CELEBRATION_MAP: Partial<Record<TierKey, WinTierName | null>> = {
  loss: null,
  freeSpin: null,
  simpleWin: null, // "simple" wins don't get a celebration-worthy tier badge
  bigWin: "BIG WIN",
  megaWin: "MEGA WIN",
  jackpot: "JACKPOT",
  zeroRespin: null, // Cash Machine only
  // Buffalo 777 only
  ten: null,
  jack: null,
  queen: null,
  king: null,
  ace: null,
  bull: null,
  anyBar: null,
  singleBar: null,
  doubleBar: null,
  tripleBar: null,
  moneyBag: null,
  coin: null,
  // Crazy 777 only
  sevenLow: null,
  sevenMid: null,
  sevenHigh: null,
  anySeven: null,
  anyGlobal: null,
  multiplier2x: null,
  multiplier5x: null,
  multiplier10x: null,
  dollarPlus: null,
  doubleDollarPlus: null,
  respin: null,
  specialEmpty: null,
};

/** Admin-configured celebration for this tier, falling back to the default above for any
 * tier the admin hasn't set (including configs saved before this feature existed). */
function getCelebration(tierKey: TierKey, paytableConfig: PaytableConfigDTO): WinTierName | null {
  const configured = paytableConfig.celebrationMap?.[tierKey];
  return configured !== undefined ? configured : (DEFAULT_CELEBRATION_MAP[tierKey] ?? null);
}

function randomSymbol(): Symbol {
  return DISPLAY_SYMBOLS[Math.floor(Math.random() * DISPLAY_SYMBOLS.length)];
}

function randomWild(): Symbol {
  const wilds = [...WILD_SYMBOLS];
  return wilds[Math.floor(Math.random() * wilds.length)];
}

function randomSeven(exclude?: Symbol): Symbol {
  const sevens = [...SEVEN_SYMBOLS].filter((s) => s !== exclude);
  return sevens[Math.floor(Math.random() * sevens.length)];
}

function randomBar(exclude?: Symbol): Symbol {
  const bars = [...BAR_SYMBOLS].filter((s) => s !== exclude);
  return bars[Math.floor(Math.random() * bars.length)];
}

/**
 * Wilds substitute freely for Seven- or Bar-family symbols (never bridging the two
 * families). Used only as a rejection-sampling guard for synthesizing a genuine "loss"
 * line now — win lines are constructed directly per rule (see buildLineForRule).
 */
function evaluateLine(line: [Symbol, Symbol, Symbol]): WinRuleId | null {
  const wildCount = line.filter((s) => WILD_SYMBOLS.has(s)).length;
  if (wildCount === 3) return "WILD_JACKPOT";

  const nonWild = line.filter((s) => !WILD_SYMBOLS.has(s));
  const allSevenFamily = nonWild.every((s) => SEVEN_SYMBOLS.has(s));
  if (allSevenFamily && nonWild.length > 0) {
    const distinctColors = new Set(nonWild);
    if (distinctColors.size === 1) {
      const color = nonWild[0];
      if (color === "GREEN_SEVEN") return "GREEN_SEVEN";
      if (color === "ORANGE_SEVEN") return "ORANGE_SEVEN";
      if (color === "YELLOW_SEVEN") return "YELLOW_SEVEN";
    }
    return "ANY_SEVENS";
  }

  const allBarFamily = nonWild.every((s) => BAR_SYMBOLS.has(s));
  if (allBarFamily && nonWild.length > 0) {
    const distinctBars = new Set(nonWild);
    if (distinctBars.size === 1) {
      const bar = nonWild[0];
      if (bar === "TRIPLE_BAR") return "TRIPLE_BAR";
      if (bar === "SINGLE_BAR") return "SINGLE_BAR";
      return "ANY_BARS";
    }
    return "ANY_BARS";
  }

  if (wildCount >= 1) return "ONE_WILD"; // covers the (unreachable via natural draw) 2-wild case too
  return null;
}

/** A line that genuinely matches nothing — rejection-sampled, converges in 1-2 tries. */
function buildLossLine(): [Symbol, Symbol, Symbol] {
  let line: [Symbol, Symbol, Symbol];
  do {
    line = [randomSymbol(), randomSymbol(), randomSymbol()];
  } while (evaluateLine(line) !== null);
  return line;
}

/** Constructs the exact 3-symbol line for a given rule, guaranteed correct regardless of evaluateLine's own quirks. */
function buildLineForRule(ruleId: WinRuleId): [Symbol, Symbol, Symbol] {
  switch (ruleId) {
    case "WILD_JACKPOT":
      return [randomWild(), randomWild(), randomWild()];
    case "GREEN_SEVEN":
      return ["GREEN_SEVEN", "GREEN_SEVEN", "GREEN_SEVEN"];
    case "ORANGE_SEVEN":
      return ["ORANGE_SEVEN", "ORANGE_SEVEN", "ORANGE_SEVEN"];
    case "YELLOW_SEVEN":
      return ["YELLOW_SEVEN", "YELLOW_SEVEN", "YELLOW_SEVEN"];
    case "TRIPLE_BAR":
      return ["TRIPLE_BAR", "TRIPLE_BAR", "TRIPLE_BAR"];
    case "SINGLE_BAR":
      return ["SINGLE_BAR", "SINGLE_BAR", "SINGLE_BAR"];
    case "ANY_SEVENS": {
      const a = randomSeven();
      const b = randomSeven(a);
      return [a, b, a];
    }
    case "ANY_BARS": {
      const a = randomBar();
      const b = randomBar(a);
      return [a, b, a];
    }
    case "TWO_WILDS":
      return [randomWild(), randomWild(), Math.random() < 0.5 ? randomSeven() : randomBar()];
    case "ONE_WILD": {
      // Must be exactly 1 wild + 1 seven + 1 bar — any 2-non-wild-same-family combo would
      // instead read as that family's own rule (see evaluateLine).
      const positions: Symbol[] = [randomWild(), randomSeven(), randomBar()];
      for (let i = positions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [positions[i], positions[j]] = [positions[j], positions[i]];
      }
      return positions as [Symbol, Symbol, Symbol];
    }
  }
}

function buildReel(middle: Symbol): ReelResult {
  return { symbols: [randomSymbol(), middle, randomSymbol()], stopIndex: 0 };
}

/** Weighted-random pick of one tier row by frequencyPercent. Optionally excludes "freeSpin" (a bonus-round spin doesn't re-trigger itself). */
function rollTier(tiers: TierRow[], excludeFreeSpin: boolean): TierRow {
  const pool = excludeFreeSpin ? tiers.filter((t) => t.key !== "freeSpin") : tiers;
  const total = pool.reduce((sum, t) => sum + t.frequencyPercent, 0);
  let roll = (secureRandomInt(1_000_000) / 1_000_000) * total;
  for (const tier of pool) {
    roll -= tier.frequencyPercent;
    if (roll < 0) return tier;
  }
  return pool[pool.length - 1];
}

function pickRuleForTier(ruleTierMap: Record<string, string>, tierKey: TierKey): WinRuleId {
  const candidates = (Object.entries(ruleTierMap) as [WinRuleId, string][])
    .filter(([, v]) => v === tierKey)
    .map(([k]) => k);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/** Runs one authoritative, outcome-first spin: the tier is decided first (from paytableConfig's
 * frequencies), then reel symbols are synthesized to match it. betAmount is the total bet (0 during a free spin). */
export function spin(betAmount: number, isFreeSpin: boolean, paytableConfig: PaytableConfigDTO): SpinResult {
  const tier = rollTier(paytableConfig.tiers, isFreeSpin);

  let lineSymbols: [Symbol, Symbol, Symbol];
  let winRuleId: WinRuleId | null = null;
  let multiplier = 0;
  let freeSpinsAwarded = 0;

  if (tier.key === "loss") {
    lineSymbols = buildLossLine();
  } else if (tier.key === "freeSpin") {
    lineSymbols = buildLossLine();
    freeSpinsAwarded = paytableConfig.freeSpinsGranted ?? 0;
  } else {
    winRuleId = pickRuleForTier(paytableConfig.ruleTierMap ?? {}, tier.key);
    lineSymbols = buildLineForRule(winRuleId);
    multiplier = (isFreeSpin ? tier.freeSpinPayoutMultiplier : tier.payoutMultiplier) ?? 0;
  }

  const winAmount = Math.round(multiplier * betAmount * 100) / 100;
  const reels = [buildReel(lineSymbols[0]), buildReel(lineSymbols[1]), buildReel(lineSymbols[2])] as [
    ReelResult,
    ReelResult,
    ReelResult,
  ];

  return {
    reels,
    lineSymbols,
    winRuleId,
    multiplier,
    winAmount,
    tier: tier.key === "loss" ? null : getCelebration(tier.key, paytableConfig),
    freeSpinsAwarded,
  };
}

/** Forced outcomes are now exact — directly roll the requested tier instead of retrying. */
export function spinForTier(betAmount: number, isFreeSpin: boolean, targetTier: WinTierName, paytableConfig: PaytableConfigDTO): SpinResult {
  const forcedTierKey = paytableConfig.tiers
    .map((t) => t.key)
    .find((key) => getCelebration(key, paytableConfig) === targetTier);
  const tierRow = paytableConfig.tiers.find((t) => t.key === forcedTierKey);
  if (!tierRow) return spin(betAmount, isFreeSpin, paytableConfig);

  const winRuleId = pickRuleForTier(paytableConfig.ruleTierMap ?? {}, tierRow.key);
  const lineSymbols = buildLineForRule(winRuleId);
  const multiplier = (isFreeSpin ? tierRow.freeSpinPayoutMultiplier : tierRow.payoutMultiplier) ?? 0;
  const winAmount = Math.round(multiplier * betAmount * 100) / 100;
  const reels = [buildReel(lineSymbols[0]), buildReel(lineSymbols[1]), buildReel(lineSymbols[2])] as [
    ReelResult,
    ReelResult,
    ReelResult,
  ];

  return { reels, lineSymbols, winRuleId, multiplier, winAmount, tier: targetTier, freeSpinsAwarded: 0 };
}
