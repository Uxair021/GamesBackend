import { Router, Request, Response } from "express";
import { User } from "../../models/User";
import { SpinHistory } from "../../models/SpinHistory";
import { ForcedOutcome } from "../../models/ForcedOutcome";
import { requireAuth } from "../../middleware/requireAuth";
import { asyncHandler } from "../../utils/asyncHandler";
import { getPaytableConfig } from "../../services/paytableConfig";
import { emitSpinEvent } from "../../realtime/eventBus";
import { spin, spinForTier, spinWithGrid, isValidGrid, SpinResult } from "./engine";
import { sizzlingSevensMeta } from "./meta";
import {
  LINE_COST,
  BET_MULTIPLIERS,
  MIN_BET,
  MAX_BET,
  PAYLINES,
  DEFAULT_PAYTABLE,
  WILD_MULTIPLIER_BASE,
  PURE_WILD_PAYOUT,
  BONUS_TRIGGER_COUNT,
  FREE_GAMES_AWARDS,
  MYSTERY_SPIN_COUNTS,
  MYSTERY_MULTIPLIER_POOL,
} from "./config";

const router = Router();

router.get(
  "/config",
  asyncHandler(async (_req: Request, res: Response) => {
    const paytableConfig = await getPaytableConfig(sizzlingSevensMeta.id);

    const paytable = Object.keys(DEFAULT_PAYTABLE).map((key) => {
      const row = paytableConfig.tiers.find((t) => t.key === key);
      return { symbol: key, payout: row?.payoutMultiplier ?? DEFAULT_PAYTABLE[key as keyof typeof DEFAULT_PAYTABLE] };
    });
    const wildRow = paytableConfig.tiers.find((t) => t.key === "WILD_2X");
    // The reel now determines its own result client-side (freezes wherever Stop catches it —
    // see SizzlingSevensGame.tsx), so the client needs these weights to replicate the same
    // symbol distribution admin configured, rather than the server drawing the grid itself.
    const symbolWeights = Object.fromEntries(paytableConfig.tiers.map((t) => [t.key, t.frequencyPercent]));

    res.json({
      meta: sizzlingSevensMeta,
      lineCost: LINE_COST,
      betMultipliers: BET_MULTIPLIERS,
      minBet: MIN_BET,
      maxBet: MAX_BET,
      paylineCount: PAYLINES.length,
      paylines: PAYLINES,
      paytable,
      symbolWeights,
      wild: {
        symbol: "WILD_2X",
        multiplierBase: WILD_MULTIPLIER_BASE,
        purePayout: { 1: PURE_WILD_PAYOUT[1], 2: PURE_WILD_PAYOUT[2], 3: wildRow?.payoutMultiplier ?? PURE_WILD_PAYOUT[3] },
      },
      bonus: { symbol: "BONUS", triggerCount: BONUS_TRIGGER_COUNT },
      freeGames: {
        awards: FREE_GAMES_AWARDS.map((a) => ({ freeSpins: a.freeSpins, multiplierPool: a.multiplierPool })),
        mystery: { spinCounts: MYSTERY_SPIN_COUNTS, multiplierPool: MYSTERY_MULTIPLIER_POOL },
      },
    });
  })
);

router.post(
  "/spin",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const betMultiplier = Number(req.body?.betMultiplier);
    const isFreeSpin = Boolean(req.body?.isFreeSpin);
    const freeGameMultiplierPool: number[] | null =
      isFreeSpin && Array.isArray(req.body?.freeGameMultiplierPool) ? req.body.freeGameMultiplierPool.map(Number) : null;
    // The reel freezes wherever the player clicks Stop and reports what's actually showing —
    // see games/SizzlingSevens/engine.ts's spinWithGrid doc comment for why the server no
    // longer draws this itself. Falls back to a server-drawn grid if omitted (e.g. an older
    // client, or a direct API caller).
    const clientGrid = req.body?.grid;
    if (clientGrid !== undefined && !isValidGrid(clientGrid)) {
      res.status(400).json({ error: "grid must be a 3x3 array of valid symbol strings" });
      return;
    }

    if (!Number.isFinite(betMultiplier) || !BET_MULTIPLIERS.includes(betMultiplier)) {
      res.status(400).json({ error: `betMultiplier must be one of ${BET_MULTIPLIERS.join(", ")}` });
      return;
    }
    if (isFreeSpin && (!freeGameMultiplierPool || freeGameMultiplierPool.length === 0)) {
      res.status(400).json({ error: "freeGameMultiplierPool is required for a free spin" });
      return;
    }

    const totalBet = LINE_COST * betMultiplier;

    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (!isFreeSpin && user.balance < totalBet) {
      res.status(400).json({ error: "Insufficient balance" });
      return;
    }

    const paytableConfig = await getPaytableConfig(sizzlingSevensMeta.id);

    const forcedOutcome = await ForcedOutcome.findOneAndUpdate(
      { userId: user._id, gameId: sizzlingSevensMeta.id, status: "pending" },
      { $set: { status: "consumed", consumedAt: new Date() } },
      { sort: { createdAt: 1 }, new: true }
    );

    const result: SpinResult = forcedOutcome
      ? spinForTier(betMultiplier, totalBet, forcedOutcome.targetTier, paytableConfig)
      : clientGrid
        ? spinWithGrid(clientGrid, betMultiplier, totalBet, paytableConfig, freeGameMultiplierPool)
        : spin(betMultiplier, totalBet, paytableConfig, freeGameMultiplierPool);

    const stakedAmount = isFreeSpin ? 0 : totalBet;
    user.balance = Math.round((user.balance - stakedAmount + result.winAmount) * 100) / 100;
    await user.save();

    const spinDoc = await SpinHistory.create({
      userId: user._id,
      gameId: sizzlingSevensMeta.id,
      betAmount: stakedAmount,
      winAmount: result.winAmount,
      reelSymbols: result.grid,
      balanceAfter: user.balance,
      tier: result.tier,
      forced: Boolean(forcedOutcome),
      forcedOutcomeId: forcedOutcome?._id ?? null,
    });

    if (forcedOutcome) {
      forcedOutcome.consumedSpinId = spinDoc._id;
      await forcedOutcome.save();
    }

    emitSpinEvent({
      userId: String(user._id),
      username: user.username,
      gameId: sizzlingSevensMeta.id,
      bet: stakedAmount,
      winAmount: result.winAmount,
      tier: result.tier,
      forced: Boolean(forcedOutcome),
      balanceAfter: user.balance,
      createdAt: spinDoc.createdAt.toISOString(),
    });

    res.json({
      grid: result.grid,
      evaluation: result.evaluation,
      winAmount: result.winAmount,
      tier: result.tier,
      freeGamesAward: result.freeGamesAward,
      balance: user.balance,
      meta: { forced: Boolean(forcedOutcome) },
    });
  })
);

export default router;
