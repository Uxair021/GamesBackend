import { Schema, model, Document, Types } from "mongoose";

/**
 * Top Dollar's bonus round is the first feature in this codebase where the final payout
 * depends on a player choice (Take It / Try Again) made *after* the spin request already
 * returned — every other game resolves entirely within one authoritative /spin call. All 4
 * offers are pre-rolled server-side at spin time (see games/TopDollar/engine.ts's
 * generateOffers) so the sequence can't be tampered with, but they are deliberately NOT all
 * sent to the client at once — only `offers[currentIndex]` is ever revealed (via /spin and
 * /bonus-advance), one at a time. Sending the full array up front would let anyone reading the
 * network response just pick the best of the 4 every time, which — since each offer is an
 * independent random draw — would skew realized RTP well above target (E[max of 4] > E[1]).
 * /bonus-resolve always credits whichever offer is currently revealed server-side, never an
 * index the client supplies.
 */
export interface ITopDollarBonus extends Document {
  userId: Types.ObjectId;
  betAmount: number;
  reelSymbols: string[];
  /** The 4 pre-rolled flat-dollar offers (First..Last) — fixed at creation, never re-rolled.
   * Never sent to the client in full — see this model's doc comment. */
  offers: number[];
  /** Index (0-3) of the offer currently shown to the player — advances by 1 per Try Again. */
  currentIndex: number;
  status: "pending" | "resolved";
  /** The SpinHistory row created at spin time (winAmount 0) — updated in place once resolved. */
  spinHistoryId: Types.ObjectId;
  createdAt: Date;
  resolvedAt: Date | null;
}

const topDollarBonusSchema = new Schema<ITopDollarBonus>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  betAmount: { type: Number, required: true },
  reelSymbols: { type: [String], required: true },
  offers: { type: [Number], required: true },
  currentIndex: { type: Number, required: true, default: 0 },
  status: { type: String, enum: ["pending", "resolved"], required: true, default: "pending" },
  spinHistoryId: { type: Schema.Types.ObjectId, ref: "SpinHistory", required: true },
  createdAt: { type: Date, default: () => new Date(), index: true },
  resolvedAt: { type: Date, default: null },
});

export const TopDollarBonus = model<ITopDollarBonus>("TopDollarBonus", topDollarBonusSchema);
