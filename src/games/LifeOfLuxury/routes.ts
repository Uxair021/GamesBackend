import { Router, Request, Response } from "express";
import { User } from "../../models/User";
import { SpinHistory } from "../../models/SpinHistory";
import { ForcedOutcome } from "../../models/ForcedOutcome";
import { FreeSpinRound } from "../../models/FreeSpinRound";
import { requireAuth } from "../../middleware/requireAuth";
import { asyncHandler } from "../../utils/asyncHandler";
import { getPaytableConfig } from "../../services/paytableConfig";
import { emitSpinEvent } from "../../realtime/eventBus";
import { spin, spinForTier, SpinResult } from "./engine";
import { lifeOfLuxuryMeta } from "./meta";
import { BET_LEVELS, LINE_COUNT, PAYLINES, DEFAULT_SYMBOL_PAYOUTS, DEFAULT_SCATTER_RULES, SCATTER_TRIGGER_COUNT, WILD_SYMBOL } from "./config";

const router = Router();

router.get(
  "/config",
  asyncHandler(async (_req: Request, res: Response) => {
    const paytableConfig = await getPaytableConfig(lifeOfLuxuryMeta.id);

    const symbolPayouts = Object.keys(DEFAULT_SYMBOL_PAYOUTS).map((key) => {
      const symbol = key as keyof typeof DEFAULT_SYMBOL_PAYOUTS;
      const row = paytableConfig.symbolPayouts?.[symbol];
      return { symbol, ...(row ?? DEFAULT_SYMBOL_PAYOUTS[symbol]) };
    });
    const scatterRules = paytableConfig.scatterRules ?? DEFAULT_SCATTER_RULES;
    // The reel builds its own cosmetic scrolling filler client-side (see pixi/Reel.ts), so the
    // client needs these weights to replicate the same symbol distribution admin configured —
    // the landed grid itself always comes from the server's spin response, this is filler only.
    const symbolWeights = Object.fromEntries(paytableConfig.tiers.map((t) => [t.key, t.frequencyPercent]));

    res.json({
      meta: lifeOfLuxuryMeta,
      lineCount: LINE_COUNT,
      betLevels: BET_LEVELS,
      minBet: BET_LEVELS[0],
      maxBet: BET_LEVELS[BET_LEVELS.length - 1],
      paylines: PAYLINES,
      symbolPayouts,
      symbolWeights,
      scatter: {
        symbol: "COIN",
        triggerCount: SCATTER_TRIGGER_COUNT,
        ...scatterRules,
      },
    });
  })
);

router.post(
  "/spin",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const bet = Number(req.body?.bet);

    if (!Number.isFinite(bet) || !BET_LEVELS.includes(bet)) {
      res.status(400).json({ error: `bet must be one of ${BET_LEVELS.join(", ")}` });
      return;
    }

    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Authoritative, not the client's own isFreeSpin flag — a round only exists here once a base
    // spin actually awarded one (see below), so a client can no longer just claim every spin is
    // free to dodge the stake.
    let activeRound = await FreeSpinRound.findOne({ userId: user._id, gameId: lifeOfLuxuryMeta.id });
    const isFreeSpin = Boolean(activeRound && activeRound.remaining > 0);

    if (!isFreeSpin && user.balance < bet) {
      res.status(400).json({ error: "Insufficient balance" });
      return;
    }

    const paytableConfig = await getPaytableConfig(lifeOfLuxuryMeta.id);

    const forcedOutcome = await ForcedOutcome.findOneAndUpdate(
      { userId: user._id, gameId: lifeOfLuxuryMeta.id, status: "pending" },
      { $set: { status: "consumed", consumedAt: new Date() } },
      { sort: { createdAt: 1 }, new: true }
    );

    const result: SpinResult = forcedOutcome
      ? spinForTier(bet, forcedOutcome.targetTier, paytableConfig)
      : spin(bet, paytableConfig, isFreeSpin);

    // End-of-round wild bonus: total free-spin win × (wilds seen across the round + 1) — see
    // models/FreeSpinRound.ts. Only wilds landing *during* the round count, never the triggering
    // base spin's own grid. bonusWin is credited on top of this spin's own winAmount, which (like
    // every other free spin in the round) is still paid out immediately below.
    let freeSpinRoundResult: {
      totalWin: number;
      wildCount: number;
      multiplier: number;
      bonusWin: number;
      finalWin: number;
    } | null = null;
    let bonusWin = 0;

    if (isFreeSpin && activeRound) {
      const wildCount = result.grid.reduce((sum, reel) => sum + reel.filter((s) => s === WILD_SYMBOL).length, 0);
      activeRound.wildCount += wildCount;
      activeRound.totalWin += result.winAmount;
      activeRound.remaining -= 1;

      if (activeRound.remaining <= 0) {
        const multiplier = activeRound.wildCount + 1;
        bonusWin = Math.round(activeRound.totalWin * activeRound.wildCount * 100) / 100;
        freeSpinRoundResult = {
          totalWin: activeRound.totalWin,
          wildCount: activeRound.wildCount,
          multiplier,
          bonusWin,
          finalWin: Math.round((activeRound.totalWin + bonusWin) * 100) / 100,
        };
        await FreeSpinRound.deleteOne({ _id: activeRound._id });
        activeRound = null;
      } else {
        await activeRound.save();
      }
    }

    const stakedAmount = isFreeSpin ? 0 : bet;
    user.balance = Math.round((user.balance - stakedAmount + result.winAmount + bonusWin) * 100) / 100;
    await user.save();

    // A base spin's own Coin trigger starts the round others will play through.
    if (!isFreeSpin && result.freeSpinsAwarded) {
      await FreeSpinRound.findOneAndUpdate(
        { userId: user._id, gameId: lifeOfLuxuryMeta.id },
        {
          $set: {
            betAmount: bet,
            totalSpins: result.freeSpinsAwarded,
            remaining: result.freeSpinsAwarded,
            wildCount: 0,
            totalWin: 0,
          },
        },
        { upsert: true }
      );
    }

    const spinDoc = await SpinHistory.create({
      userId: user._id,
      gameId: lifeOfLuxuryMeta.id,
      betAmount: stakedAmount,
      winAmount: result.winAmount + bonusWin,
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
      gameId: lifeOfLuxuryMeta.id,
      bet: stakedAmount,
      winAmount: result.winAmount + bonusWin,
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
      freeSpinsAwarded: result.freeSpinsAwarded,
      freeSpinRoundResult,
      balance: user.balance,
      meta: { forced: Boolean(forcedOutcome) },
    });
  })
);

export default router;
