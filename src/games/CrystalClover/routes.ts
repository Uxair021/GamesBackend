import { Router, Request, Response } from "express";
import { User } from "../../models/User";
import { SpinHistory } from "../../models/SpinHistory";
import { ForcedOutcome } from "../../models/ForcedOutcome";
import { requireAuth } from "../../middleware/requireAuth";
import { asyncHandler } from "../../utils/asyncHandler";
import { getPaytableConfig } from "../../services/paytableConfig";
import { emitSpinEvent } from "../../realtime/eventBus";
import { spin, spinForTier, SpinResult } from "./engine";
import { crystalCloverMeta } from "./meta";
import { BET_LEVELS, MIN_BET, MAX_BET, PAYLINES, WinRuleId } from "./config";
import { PaytableConfigDTO } from "../../services/paytableConfig";

const router = Router();

/** The payout a cosmetic WIN_RULE_ID actually credits — whatever tier the admin's ruleTierMap
 * currently assigns it to (see engine.ts's doc comment: the rule id only decides which symbols
 * render, the tier it's mapped to decides the payout). Falls back to 0 if unmapped. */
function payoutForRule(ruleId: WinRuleId, config: PaytableConfigDTO): number {
  const tierKey = config.ruleTierMap?.[ruleId];
  const tierRow = tierKey ? config.tiers.find((t) => t.key === tierKey) : undefined;
  return tierRow?.payoutMultiplier ?? 0;
}

router.get(
  "/config",
  asyncHandler(async (_req: Request, res: Response) => {
    const paytableConfig = await getPaytableConfig(crystalCloverMeta.id);

    const paytable = (["SEVEN_CLOVER", "TRIPLE_BAR", "DOUBLE_BAR", "BAR"] as const).map((symbol) => ({
      symbol,
      payout: payoutForRule(symbol, paytableConfig),
    }));

    res.json({
      meta: crystalCloverMeta,
      betLevels: BET_LEVELS,
      minBet: MIN_BET,
      maxBet: MAX_BET,
      paylineCount: PAYLINES.length,
      paylines: PAYLINES,
      paytable,
      anyBarPayout: payoutForRule("ANY_BAR", paytableConfig),
      wild: {
        symbol: "WILD",
        multiplierBase: 2,
        purePayout: {
          1: payoutForRule("ONE_WILD", paytableConfig),
          2: payoutForRule("TWO_WILD", paytableConfig),
          3: payoutForRule("THREE_WILD", paytableConfig),
        },
      },
      multiplier: { symbol: "MULTIPLIER_2X", base: 2 },
    });
  })
);

router.post(
  "/spin",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const totalBet = Number(req.body?.betLevel);
    if (!Number.isFinite(totalBet) || !BET_LEVELS.includes(totalBet)) {
      res.status(400).json({ error: `betLevel must be one of ${BET_LEVELS.join(", ")}` });
      return;
    }

    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (user.balance < totalBet) {
      res.status(400).json({ error: "Insufficient balance" });
      return;
    }

    const paytableConfig = await getPaytableConfig(crystalCloverMeta.id);

    const forcedOutcome = await ForcedOutcome.findOneAndUpdate(
      { userId: user._id, gameId: crystalCloverMeta.id, status: "pending" },
      { $set: { status: "consumed", consumedAt: new Date() } },
      { sort: { createdAt: 1 }, new: true }
    );

    const result: SpinResult = forcedOutcome
      ? spinForTier(totalBet, forcedOutcome.targetTier, paytableConfig)
      : spin(totalBet, paytableConfig);

    user.balance = Math.round((user.balance - totalBet + result.winAmount) * 100) / 100;
    await user.save();

    const spinDoc = await SpinHistory.create({
      userId: user._id,
      gameId: crystalCloverMeta.id,
      betAmount: totalBet,
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
      gameId: crystalCloverMeta.id,
      bet: totalBet,
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
      balance: user.balance,
      meta: { forced: Boolean(forcedOutcome) },
    });
  })
);

export default router;
