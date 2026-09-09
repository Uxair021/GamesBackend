/**
 * 7 Crystal Clover — outcome-first engine, same shape as ShamrockSpin (see that game's engine.ts):
 * one discrete win-tier is rolled per spin from the admin's `tiers` (loss/simpleWin/bigWin/
 * megaWin/jackpot), a specific cosmetic WIN_RULE_ID is picked within that tier (`ruleTierMap`,
 * doesn't affect payout), and a line is designated to carry it. The MULTIPLIER_2X count is a
 * second, fully independent roll (`specialReelTiers`, mirrors Crazy 777's reel 4) applied as a
 * flat ×1/×2/×4/×8 on top of whatever the matched lines pay.
 *
 * Grid shape (per user request): every reel always shows either 1 symbol on the middle
 * (payline p1) row — top/bottom empty — or 2 symbols on the top+bottom (p0/p2) rows — middle
 * empty. Never all 3. A reel touched by the designated line has its state forced by which row
 * that line needs; an untouched reel (only possible on a rolled "loss", since every one of the
 * 9 PAYLINES touches all 3 reels) rolls its own state via the admin's
 * `reelStateConfig.centerRowChancePercent`. Because the grid can now incidentally satisfy a
 * line beyond the designated one, **every one of the 9 lines is evaluated for real** after the
 * grid is built (see evaluateAllLines) and every match pays, summed — confirmed with the user
 * as an accepted trade-off over the exact closed-form RTP the old "avoid every accidental
 * match" filler logic guaranteed (see services/paytableConfig.ts's
 * computeCrystalCloverRtpPercent doc comment).
 */

import { WinTierName } from "../../gameTiers";
import { PaytableConfigDTO } from "../../services/paytableConfig";
import { TierKey, TierRow } from "../../models/PaytableConfig";
import { Grid, LineWin, SpinEvaluation, classifyLine } from "./winCalc";
import { CrystalCloverSymbol, REEL_COUNT, ROW_COUNT, PAYLINES, WILD_SYMBOL, MULTIPLIER_SYMBOL, BAR_FAMILY, WIN_RULE_IDS, WinRuleId } from "./config";

export interface SpinResult {
  grid: Grid;
  evaluation: SpinEvaluation;
  winAmount: number;
  tier: WinTierName | null;
}

/** Fallback used whenever the admin hasn't set (or saved before this feature existed) a
 * celebration for a given tier — mirrors ShamrockSpin's DEFAULT_CELEBRATION_MAP exactly, scoped
 * to this game's own tier keys. */
const DEFAULT_CELEBRATION_MAP: Partial<Record<TierKey, WinTierName | null>> = {
  loss: null,
  simpleWin: null,
  bigWin: "BIG WIN",
  megaWin: "MEGA WIN",
  jackpot: "JACKPOT",
};

function getCelebration(tierKey: TierKey, paytableConfig: PaytableConfigDTO): WinTierName | null {
  const configured = paytableConfig.celebrationMap?.[tierKey];
  return configured !== undefined ? configured : (DEFAULT_CELEBRATION_MAP[tierKey] ?? null);
}

/** Ranks a celebration tier so a spin with several incidental wins celebrates at least as big
 * as its best individual matched line. */
function celebrationRank(tier: WinTierName | null): number {
  if (tier === "JACKPOT") return 3;
  if (tier === "MEGA WIN") return 2;
  if (tier === "BIG WIN") return 1;
  return 0;
}

/** Weighted-random pick of one tier row by frequencyPercent — same helper shape as every other
 * outcome-first game (ShamrockSpin/Buffalo 777/5x Rewind). */
function weightedPick(rows: TierRow[]): TierRow | null {
  if (rows.length === 0) return null;
  const total = rows.reduce((sum, t) => sum + t.frequencyPercent, 0);
  let roll = Math.random() * total;
  for (const row of rows) {
    roll -= row.frequencyPercent;
    if (roll < 0) return row;
  }
  return rows[rows.length - 1];
}

/** Uniform pick among whichever WIN_RULE_IDs the admin's ruleTierMap has mapped to this tier key
 * — mirrors ShamrockSpin's pickRuleForTier. Purely cosmetic (see this file's doc comment). */
function pickRuleForTier(ruleTierMap: Record<string, string>, tierKey: TierKey): WinRuleId {
  const candidates = (Object.entries(ruleTierMap) as [WinRuleId, string][]).filter(([, v]) => v === tierKey).map(([k]) => k);
  // Falls back to any rule id (never crashes on an incomplete/misconfigured ruleTierMap, e.g. an
  // admin reassigning every rule away from this tier) — cosmetic only, so a wrong-looking symbol
  // combo here still pays exactly tierRow.payoutMultiplier, nothing is lost but the visual match.
  if (candidates.length === 0) return WIN_RULE_IDS[Math.floor(Math.random() * WIN_RULE_IDS.length)];
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/** How many MULTIPLIER_2X copies to cosmetically place on the grid for each special-reel tier —
 * paired 1:1 with that tier's own admin-editable payoutMultiplier (the ×1/×2/×4/×8 actually
 * credited), so "multiplier2x" always shows exactly 1 copy, "multiplier4x" 2 copies, etc. Purely
 * a display count; the credited factor always comes from the rolled row's own payoutMultiplier,
 * not from this count. */
const MULTIPLIER_COPY_COUNT: Partial<Record<TierKey, number>> = {
  specialEmpty: 0,
  multiplier2x: 1,
  multiplier4x: 2,
  multiplier8x: 3,
};

const FILLER_POOL: CrystalCloverSymbol[] = ["SEVEN_CLOVER", "BAR", "DOUBLE_BAR", "TRIPLE_BAR"];
function randomFiller(): CrystalCloverSymbol {
  return FILLER_POOL[Math.floor(Math.random() * FILLER_POOL.length)];
}

function randomBarFamily(exclude?: CrystalCloverSymbol): CrystalCloverSymbol {
  const pool = exclude ? BAR_FAMILY.filter((s) => s !== exclude) : BAR_FAMILY;
  return pool[Math.floor(Math.random() * pool.length)] as CrystalCloverSymbol;
}

function shuffle3<T>(items: [T, T, T]): [T, T, T] {
  const arr = [...items] as [T, T, T];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** The exact 3-symbol line for a given rule — the only place a rule's cosmetic pattern is
 * defined, mirrors ShamrockSpin's buildLineForRule. */
function buildSymbolsForRule(ruleId: WinRuleId): [CrystalCloverSymbol, CrystalCloverSymbol, CrystalCloverSymbol] {
  switch (ruleId) {
    case "SEVEN_CLOVER":
      return ["SEVEN_CLOVER", "SEVEN_CLOVER", "SEVEN_CLOVER"];
    case "TRIPLE_BAR":
      return ["TRIPLE_BAR", "TRIPLE_BAR", "TRIPLE_BAR"];
    case "DOUBLE_BAR":
      return ["DOUBLE_BAR", "DOUBLE_BAR", "DOUBLE_BAR"];
    case "BAR":
      return ["BAR", "BAR", "BAR"];
    case "ANY_BAR": {
      const a = randomBarFamily();
      const b = randomBarFamily(a);
      return [a, b, a];
    }
    case "ONE_WILD":
      return shuffle3([WILD_SYMBOL, randomFiller(), randomFiller()]);
    case "TWO_WILD":
      return shuffle3([WILD_SYMBOL, WILD_SYMBOL, randomFiller()]);
    case "THREE_WILD":
      return [WILD_SYMBOL, WILD_SYMBOL, WILD_SYMBOL];
  }
}

function rollReelState(centerRowChancePercent: number): "CENTER" | "TOP_BOTTOM" {
  return Math.random() * 100 < centerRowChancePercent ? "CENTER" : "TOP_BOTTOM";
}

/** Builds the full grid: the designated line (if any) gets `lineSymbols` on its 3 cells, which
 * also forces each of those 3 reels' 2-state shape (row 1 required -> center-only, the reel's
 * top/bottom stay empty; row 0/2 required -> top+bottom, the *other* of {0,2} filled with a
 * random filler, the reel's middle stays empty). A reel the designated line doesn't touch (only
 * possible when there's no designated line at all, i.e. a rolled "loss") rolls its own state via
 * `centerRowChancePercent`. Accidental extra matches from free/filler cells are no longer
 * avoided (see this file's doc comment) — `multiplierCopies` MULTIPLIER_2X symbols are then
 * sprinkled onto cells that are outside the designated line AND already hold a real filler
 * symbol (never onto an empty slot, which would break a reel's 2-state shape). */
function buildGrid(
  designatedLineIndex: number | null,
  lineSymbols: [CrystalCloverSymbol, CrystalCloverSymbol, CrystalCloverSymbol] | null,
  multiplierCopies: number,
  centerRowChancePercent: number
): Grid {
  const grid: (CrystalCloverSymbol | null)[][] = Array.from({ length: REEL_COUNT }, () => new Array(ROW_COUNT).fill(null));
  const designatedCells = new Set<string>();
  if (designatedLineIndex !== null) {
    PAYLINES[designatedLineIndex].forEach((row, reel) => designatedCells.add(`${reel},${row}`));
  }

  for (let reel = 0; reel < REEL_COUNT; reel++) {
    const requiredRow = designatedLineIndex !== null ? PAYLINES[designatedLineIndex][reel] : null;

    if (requiredRow !== null && lineSymbols) {
      const requiredSymbol = lineSymbols[reel];
      if (requiredRow === 1) {
        grid[reel][1] = requiredSymbol; // center-only — rows 0/2 stay null
      } else {
        grid[reel][requiredRow] = requiredSymbol;
        grid[reel][requiredRow === 0 ? 2 : 0] = randomFiller(); // top+bottom — row 1 stays null
      }
    } else {
      const state = rollReelState(centerRowChancePercent);
      if (state === "CENTER") {
        grid[reel][1] = randomFiller();
      } else {
        grid[reel][0] = randomFiller();
        grid[reel][2] = randomFiller();
      }
    }
  }

  if (multiplierCopies > 0) {
    const eligible: [number, number][] = [];
    for (let reel = 0; reel < REEL_COUNT; reel++) {
      for (let row = 0; row < ROW_COUNT; row++) {
        if (designatedCells.has(`${reel},${row}`)) continue;
        if (grid[reel][row] === null) continue;
        eligible.push([reel, row]);
      }
    }
    for (let i = eligible.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
    }
    eligible.slice(0, multiplierCopies).forEach(([reel, row]) => (grid[reel][row] = MULTIPLIER_SYMBOL));
  }

  return grid as Grid;
}

/** Checks all 9 PAYLINES against the built grid and pays every one that matches, summed (see
 * this file's doc comment) — not just the designated line. `bestTier` is the celebration for
 * whichever matched line resolves to the highest tier (see celebrationRank), so a spin with
 * several incidental wins still celebrates appropriately. */
function evaluateAllLines(
  grid: Grid,
  paytableConfig: PaytableConfigDTO,
  betMultiplier: number
): { lineWins: LineWin[]; totalLineWin: number; winningPositions: [number, number][]; bestTier: WinTierName | null } {
  const ruleTierMap = paytableConfig.ruleTierMap ?? {};
  const lineWins: LineWin[] = [];
  let totalLineWin = 0;
  let bestTier: WinTierName | null = null;
  const winningPositions: [number, number][] = [];
  const seenPositions = new Set<string>();

  PAYLINES.forEach((line, lineIdx) => {
    const cells = line.map((row, reel) => grid[reel][row]) as [
      CrystalCloverSymbol | null,
      CrystalCloverSymbol | null,
      CrystalCloverSymbol | null,
    ];
    const ruleId = classifyLine(cells);
    if (!ruleId) return;

    const tierKey = ruleTierMap[ruleId] as TierKey | undefined;
    const tierRow = tierKey ? paytableConfig.tiers.find((t) => t.key === tierKey) : undefined;
    const basePayout = tierRow?.payoutMultiplier ?? 0;
    if (basePayout <= 0) return;

    const symbols = cells as [CrystalCloverSymbol, CrystalCloverSymbol, CrystalCloverSymbol];
    const isPureWild = ruleId === "ONE_WILD" || ruleId === "TWO_WILD" || ruleId === "THREE_WILD";
    const isAnyBar = ruleId === "ANY_BAR";
    const wildCount = symbols.filter((s) => s === WILD_SYMBOL).length;
    const positions: [number, number][] = line.map((row, reel) => [reel, row] as [number, number]);
    const lineFinalWin = basePayout * betMultiplier;

    lineWins.push({
      lineNumber: lineIdx + 1,
      symbol: isPureWild ? WILD_SYMBOL : symbols[0],
      matchCount: 3,
      basePayout,
      wildCount,
      wildMultiplier: 1,
      betMultiplier,
      finalWin: lineFinalWin,
      positions,
      isPureWild,
      isAnyBar,
    });
    totalLineWin += lineFinalWin;

    const lineTier = tierKey ? getCelebration(tierKey, paytableConfig) : null;
    if (celebrationRank(lineTier) > celebrationRank(bestTier)) bestTier = lineTier;

    for (const pos of positions) {
      const key = `${pos[0]},${pos[1]}`;
      if (!seenPositions.has(key)) {
        seenPositions.add(key);
        winningPositions.push(pos);
      }
    }
  });

  return { lineWins, totalLineWin, winningPositions, bestTier };
}

function resolve(
  tierRow: TierRow,
  ruleTierMap: Record<string, string>,
  specialReelTiers: TierRow[],
  reelStateConfig: { centerRowChancePercent: number } | null,
  totalBet: number,
  paytableConfig: PaytableConfigDTO
): SpinResult {
  const multiplierRow = weightedPick(specialReelTiers);
  const multiplierFactor = multiplierRow?.payoutMultiplier ?? 1;
  const multiplierCopies = (multiplierRow && MULTIPLIER_COPY_COUNT[multiplierRow.key]) ?? 0;

  let lineIndex: number | null = null;
  let lineSymbols: [CrystalCloverSymbol, CrystalCloverSymbol, CrystalCloverSymbol] | null = null;

  if (tierRow.key !== "loss") {
    const ruleId = pickRuleForTier(ruleTierMap, tierRow.key);
    lineIndex = Math.floor(Math.random() * PAYLINES.length);
    lineSymbols = buildSymbolsForRule(ruleId);
  }

  const centerRowChancePercent = reelStateConfig?.centerRowChancePercent ?? 50;
  const grid = buildGrid(lineIndex, lineSymbols, multiplierCopies, centerRowChancePercent);

  const { lineWins, totalLineWin, winningPositions, bestTier } = evaluateAllLines(grid, paytableConfig, totalBet);
  const finalWin = totalLineWin * multiplierFactor;
  const winAmount = Math.round(finalWin * 100) / 100;

  const evaluation: SpinEvaluation = {
    lineWins,
    totalLineWin,
    multiplierCount: multiplierCopies,
    multiplierFactor,
    finalWin,
    winningPositions,
  };

  return { grid, evaluation, winAmount, tier: bestTier };
}

/** Runs one authoritative, outcome-first spin: the tier is decided first (from paytableConfig's
 * frequencies), then the grid is synthesized to match — same pattern as ShamrockSpin's spin(). */
export function spin(totalBet: number, paytableConfig: PaytableConfigDTO): SpinResult {
  const tierRow = weightedPick(paytableConfig.tiers) ?? { key: "loss" as const, frequencyPercent: 100, payoutMultiplier: null, freeSpinPayoutMultiplier: null };
  return resolve(tierRow, paytableConfig.ruleTierMap ?? {}, paytableConfig.specialReelTiers ?? [], paytableConfig.reelStateConfig ?? null, totalBet, paytableConfig);
}

/** Forced outcomes are exact — directly roll the requested tier's rule instead of retrying
 * until it happens naturally. Mirrors ShamrockSpin's spinForTier. */
export function spinForTier(totalBet: number, targetTier: WinTierName, paytableConfig: PaytableConfigDTO): SpinResult {
  const forcedTierKey = paytableConfig.tiers.map((t) => t.key).find((key) => getCelebration(key, paytableConfig) === targetTier);
  const tierRow = paytableConfig.tiers.find((t) => t.key === forcedTierKey);
  if (!tierRow) return spin(totalBet, paytableConfig);
  return resolve(tierRow, paytableConfig.ruleTierMap ?? {}, paytableConfig.specialReelTiers ?? [], paytableConfig.reelStateConfig ?? null, totalBet, paytableConfig);
}
