import { Request, Response } from "express";
import {
  getPaytableConfig,
  validatePaytableConfig,
  savePaytableConfig,
  computeSizzlingSevensStats,
  PaytableConfigDTO,
} from "../../services/paytableConfig";
import { TierKey, TierRow } from "../../models/PaytableConfig";
import { sizzlingSevensMeta } from "../../games/SizzlingSevens/meta";

const VALID_TIER_KEYS: TierKey[] = [
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
];

export async function getPaytable(req: Request, res: Response): Promise<void> {
  const { gameId } = req.params;
  const config = await getPaytableConfig(gameId);
  const validation = validatePaytableConfig(config);
  const lossPercent = gameId === sizzlingSevensMeta.id ? computeSizzlingSevensStats(config).lossPercent : undefined;
  res.json({ config, computedRtpPercent: validation.computedRtpPercent, valid: validation.valid, lossPercent });
}

const VALID_CELEBRATIONS = ["BIG WIN", "MEGA WIN", "JACKPOT"];

/** `undefined`/absent body.celebrationMap means "keep it null" (feature unused); a present
 * value must be a plain object mapping known tier keys to one of the 3 celebrations or null. */
function parseCelebrationMap(body: unknown): Record<string, string | null> | null | undefined {
  if (body === null || body === undefined) return null;
  if (typeof body !== "object" || Array.isArray(body)) return undefined;
  const entries = Object.entries(body as Record<string, unknown>);
  const result: Record<string, string | null> = {};
  for (const [key, value] of entries) {
    if (!VALID_TIER_KEYS.includes(key as TierKey)) return undefined;
    if (value !== null && !VALID_CELEBRATIONS.includes(value as string)) return undefined;
    result[key] = value as string | null;
  }
  return result;
}

function parseTierRows(body: unknown): TierRow[] | null {
  if (!Array.isArray(body)) return null;
  const rows: TierRow[] = [];
  for (const row of body) {
    if (typeof row !== "object" || row === null) return null;
    const r = row as Record<string, unknown>;
    if (typeof r.key !== "string" || !VALID_TIER_KEYS.includes(r.key as TierKey)) return null;
    if (typeof r.frequencyPercent !== "number" || !Number.isFinite(r.frequencyPercent)) return null;
    const payoutMultiplier = r.payoutMultiplier === null ? null : Number(r.payoutMultiplier);
    if (payoutMultiplier !== null && !Number.isFinite(payoutMultiplier)) return null;
    const freeSpinPayoutMultiplier = r.freeSpinPayoutMultiplier === null ? null : Number(r.freeSpinPayoutMultiplier);
    if (freeSpinPayoutMultiplier !== null && !Number.isFinite(freeSpinPayoutMultiplier)) return null;
    rows.push({
      key: r.key as TierKey,
      frequencyPercent: r.frequencyPercent,
      payoutMultiplier,
      freeSpinPayoutMultiplier,
    });
  }
  return rows;
}

export async function updatePaytable(req: Request, res: Response): Promise<void> {
  const { gameId } = req.params;
  const body = req.body ?? {};

  const targetRtpPercent = Number(body.targetRtpPercent);
  if (!Number.isFinite(targetRtpPercent) || targetRtpPercent < 0) {
    res.status(400).json({ error: "targetRtpPercent must be a non-negative number" });
    return;
  }

  const tiers = parseTierRows(body.tiers);
  if (!tiers || tiers.length === 0) {
    res.status(400).json({ error: "tiers must be a non-empty array of valid tier rows" });
    return;
  }

  const freeSpinsGranted =
    body.freeSpinsGranted === null || body.freeSpinsGranted === undefined ? null : Number(body.freeSpinsGranted);
  if (freeSpinsGranted !== null && !Number.isFinite(freeSpinsGranted)) {
    res.status(400).json({ error: "freeSpinsGranted must be a number or null" });
    return;
  }

  const celebrationMap = parseCelebrationMap(body.celebrationMap);
  if (celebrationMap === undefined) {
    res.status(400).json({ error: "celebrationMap must map known tier keys to \"BIG WIN\"/\"MEGA WIN\"/\"JACKPOT\"/null" });
    return;
  }

  let specialReelTiers: TierRow[] | null = null;
  if (body.specialReelTiers !== null && body.specialReelTiers !== undefined) {
    specialReelTiers = parseTierRows(body.specialReelTiers);
    if (!specialReelTiers || specialReelTiers.length === 0) {
      res.status(400).json({ error: "specialReelTiers must be a non-empty array of valid tier rows, or null" });
      return;
    }
  }

  let respinRange: { min: number; max: number } | null = null;
  if (body.respinRange !== null && body.respinRange !== undefined) {
    const min = Number(body.respinRange.min);
    const max = Number(body.respinRange.max);
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      res.status(400).json({ error: "respinRange must be { min, max } numbers, or null" });
      return;
    }
    respinRange = { min, max };
  }

  const config: PaytableConfigDTO = {
    gameId,
    targetRtpPercent,
    freeSpinsGranted,
    tiers,
    ruleTierMap: body.ruleTierMap ?? null,
    celebrationMap,
    amountThresholds: body.amountThresholds ?? null,
    specialReelTiers,
    respinRange,
  };

  const validation = validatePaytableConfig(config);
  if (!validation.valid) {
    res.status(400).json({ error: "Invalid paytable configuration", errors: validation.errors, computedRtpPercent: validation.computedRtpPercent });
    return;
  }

  const saved = await savePaytableConfig(config);
  const lossPercent = gameId === sizzlingSevensMeta.id ? computeSizzlingSevensStats(saved).lossPercent : undefined;
  res.json({ config: saved, computedRtpPercent: validation.computedRtpPercent, valid: true, lossPercent });
}
