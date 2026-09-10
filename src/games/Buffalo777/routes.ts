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
import { buffalo777Meta } from "./meta";

const router = Router();

router.get("/config", (_req: Request, res: Response) => {
  res.json({
    meta: buffalo777Meta,
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

    // getPaytableConfig doesn't depend on the user doc, so fetch it in parallel instead of
    // after — shaves a full DB round-trip off the critical path of every spin.
    const [user, paytableConfig] = await Promise.all([
      User.findById(req.userId),
      getPaytableConfig(buffalo777Meta.id),
    ]);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (user.balance < betAmount) {
      res.status(400).json({ error: "Insufficient balance" });
      return;
    }

    const forcedOutcome = await ForcedOutcome.findOneAndUpdate(
      { userId: user._id, gameId: buffalo777Meta.id, status: "pending" },
      { $set: { status: "consumed", consumedAt: new Date() } },
      { sort: { createdAt: 1 }, new: true }
    );

    const result = forcedOutcome
      ? spinForTier(betAmount, forcedOutcome.targetTier, paytableConfig)
      : spin(betAmount, paytableConfig);

    user.balance = Math.round((user.balance - betAmount + result.winAmount) * 100) / 100;

    // Both are independent writes — SpinHistory's balanceAfter reads the balance already
    // computed above in memory, not from user.save()'s result — so run them together
    // instead of waiting on the user save before starting the history write.
    const [, spinDoc] = await Promise.all([
      user.save(),
      SpinHistory.create({
        userId: user._id,
        gameId: buffalo777Meta.id,
        betAmount,
        winAmount: result.winAmount,
        reelSymbols: result.reels.map((r) => r.symbols),
        balanceAfter: user.balance,
        tier: result.tier,
        forced: Boolean(forcedOutcome),
        forcedOutcomeId: forcedOutcome?._id ?? null,
      }),
    ]);

    if (forcedOutcome) {
      forcedOutcome.consumedSpinId = spinDoc._id;
      await forcedOutcome.save();
    }

    emitSpinEvent({
      userId: String(user._id),
      username: user.username,
      gameId: buffalo777Meta.id,
      bet: betAmount,
      winAmount: result.winAmount,
      tier: result.tier,
      forced: Boolean(forcedOutcome),
      balanceAfter: user.balance,
      createdAt: spinDoc.createdAt.toISOString(),
    });

    res.json({
      reels: result.reels.map((r) => r.symbols),
      lineSymbols: result.lineSymbols,
      winTierKey: result.winTierKey,
      multiplier: result.multiplier,
      winAmount: result.winAmount,
      tier: result.tier,
      balance: user.balance,
      meta: { forced: Boolean(forcedOutcome) },
    });
  })
);

export default router;
