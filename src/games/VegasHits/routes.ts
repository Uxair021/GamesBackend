import { Router, Request, Response } from "express";
import { User } from "../../models/User";
import { SpinHistory } from "../../models/SpinHistory";
import { ForcedOutcome } from "../../models/ForcedOutcome";
import { requireAuth } from "../../middleware/requireAuth";
import { asyncHandler } from "../../utils/asyncHandler";
import { getPaytableConfig } from "../../services/paytableConfig";
import { emitSpinEvent } from "../../realtime/eventBus";
import { spin, spinForTier, SpinResult } from "./engine";
import { vegasHitsMeta } from "./meta";
import {
  LINE_COST,
  BET_LEVELS,
  MIN_BET,
  MAX_BET,
  PAYLINES,
  DEFAULT_PAYTABLE,
  DEFAULT_WILD_RULES,
  BONUS_TRIGGER_COUNT,
  SCATTER_PAYOUT_MULTIPLE_OF_BET,
  FREE_SPINS_PER_TRIGGER,
  MAX_TOTAL_FREE_SPINS,
  CHILI_MULTIPLIER_POOL,
} from "./config";

const router = Router();

router.get(
  "/config",
  asyncHandler(async (_req: Request, res: Response) => {
    const paytableConfig = await getPaytableConfig(vegasHitsMeta.id);

    const paytable = Object.keys(DEFAULT_PAYTABLE).map((key) => {
      const row = paytableConfig.tiers.find((t) => t.key === key);
      return { symbol: key, payout: row?.payoutMultiplier ?? DEFAULT_PAYTABLE[key as keyof typeof DEFAULT_PAYTABLE] };
    });
    // The reel determines its own result client-side (freezes wherever Stop catches it — see
    // VegasHitsGame.tsx), so the client needs these weights to replicate the same symbol
    // distribution admin configured, rather than the server drawing the grid itself.
    const symbolWeights = Object.fromEntries(paytableConfig.tiers.map((t) => [t.key, t.frequencyPercent]));

    res.json({
      meta: vegasHitsMeta,
      lineCost: LINE_COST,
      betLevels: BET_LEVELS,
      minBet: MIN_BET,
      maxBet: MAX_BET,
      paylineCount: PAYLINES.length,
      paylines: PAYLINES,
      paytable,
      symbolWeights,
      wild: { symbol: "WILD", rules: paytableConfig.wildRules ?? DEFAULT_WILD_RULES },
      bonus: {
        symbol: "BONUS",
        triggerCount: BONUS_TRIGGER_COUNT,
        scatterPayoutMultipleOfBet: SCATTER_PAYOUT_MULTIPLE_OF_BET,
      },
      freeGames: {
        spinsPerTrigger: FREE_SPINS_PER_TRIGGER,
        maxTotalFreeSpins: MAX_TOTAL_FREE_SPINS,
        chiliMultiplierPool: CHILI_MULTIPLIER_POOL,
      },
    });
  })
);

router.post(
  "/spin",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const betLevel = Number(req.body?.betLevel);
    const isFreeSpin = Boolean(req.body?.isFreeSpin);

    if (!Number.isFinite(betLevel) || !BET_LEVELS.includes(betLevel)) {
      res.status(400).json({ error: `betLevel must be one of ${BET_LEVELS.join(", ")}` });
      return;
    }

    // betLevel *is* the real total bet (0.10-30, same convention every other game uses); the
    // paytable's own numbers are all expressed relative to the fixed LINE_COST reference, so
    // the scale factor actually fed into the win-calc functions is betLevel/LINE_COST — see
    // config.ts's LINE_COST comment.
    const totalBet = betLevel;
    const betMultiplier = totalBet / LINE_COST;

    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (!isFreeSpin && user.balance < totalBet) {
      res.status(400).json({ error: "Insufficient balance" });
      return;
    }

    const paytableConfig = await getPaytableConfig(vegasHitsMeta.id);

    const forcedOutcome = await ForcedOutcome.findOneAndUpdate(
      { userId: user._id, gameId: vegasHitsMeta.id, status: "pending" },
      { $set: { status: "consumed", consumedAt: new Date() } },
      { sort: { createdAt: 1 }, new: true }
    );

    const result: SpinResult = forcedOutcome
      ? spinForTier(betMultiplier, totalBet, forcedOutcome.targetTier, paytableConfig)
      : spin(betMultiplier, totalBet, paytableConfig, isFreeSpin);

    const stakedAmount = isFreeSpin ? 0 : totalBet;
    user.balance = Math.round((user.balance - stakedAmount + result.winAmount) * 100) / 100;
    await user.save();

    const spinDoc = await SpinHistory.create({
      userId: user._id,
      gameId: vegasHitsMeta.id,
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
      gameId: vegasHitsMeta.id,
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
