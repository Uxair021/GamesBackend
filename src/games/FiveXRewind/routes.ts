import { Router, Request, Response } from "express";
import { User } from "../../models/User";
import { SpinHistory } from "../../models/SpinHistory";
import { ForcedOutcome } from "../../models/ForcedOutcome";
import { requireAuth } from "../../middleware/requireAuth";
import { asyncHandler } from "../../utils/asyncHandler";
import { getPaytableConfig } from "../../services/paytableConfig";
import { emitSpinEvent } from "../../realtime/eventBus";
import { spin, spinForTier } from "./engine";
import { REFERENCE_PAYTABLE, BET_LEVELS, MIN_BET, MAX_BET } from "./config";
import { fiveXRewindMeta } from "./meta";

const router = Router();

router.get("/config", (_req: Request, res: Response) => {
  res.json({
    meta: fiveXRewindMeta,
    paytable: REFERENCE_PAYTABLE,
    betLevels: BET_LEVELS,
  });
});

router.post(
  "/spin",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const betAmount = Number(req.body?.betAmount);

    if (!Number.isFinite(betAmount) || betAmount < MIN_BET || betAmount > MAX_BET) {
      res.status(400).json({ error: `betAmount must be between ${MIN_BET} and ${MAX_BET}` });
      return;
    }

    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (user.balance < betAmount) {
      res.status(400).json({ error: "Insufficient balance" });
      return;
    }

    const paytableConfig = await getPaytableConfig(fiveXRewindMeta.id);

    const forcedOutcome = await ForcedOutcome.findOneAndUpdate(
      { userId: user._id, gameId: fiveXRewindMeta.id, status: "pending" },
      { $set: { status: "consumed", consumedAt: new Date() } },
      { sort: { createdAt: 1 }, new: true }
    );

    const result = forcedOutcome
      ? spinForTier(betAmount, forcedOutcome.targetTier, paytableConfig)
      : spin(betAmount, paytableConfig);

    user.balance = Math.round((user.balance - betAmount + result.winAmount) * 100) / 100;
    await user.save();

    const spinDoc = await SpinHistory.create({
      userId: user._id,
      gameId: fiveXRewindMeta.id,
      betAmount,
      winAmount: result.winAmount,
      reelSymbols: result.reels.map((s) => [s]),
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
      gameId: fiveXRewindMeta.id,
      bet: betAmount,
      winAmount: result.winAmount,
      tier: result.tier,
      forced: Boolean(forcedOutcome),
      balanceAfter: user.balance,
      createdAt: spinDoc.createdAt.toISOString(),
    });

    res.json({
      reels: result.reels,
      winResult: result.winResult,
      winAmount: result.winAmount,
      tier: result.tier,
      balance: user.balance,
      meta: { forced: Boolean(forcedOutcome) },
    });
  })
);

export default router;
