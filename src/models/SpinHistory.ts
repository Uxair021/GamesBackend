import { Schema, model, Document, Types } from "mongoose";

export interface ISpinHistory extends Document {
  userId: Types.ObjectId;
  gameId: string;
  betAmount: number;
  winAmount: number;
  reelSymbols: string[][];
  balanceAfter: number;
  tier: string | null;
  forced: boolean;
  forcedOutcomeId: Types.ObjectId | null;
  createdAt: Date;
}

const spinHistorySchema = new Schema<ISpinHistory>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  gameId: { type: String, required: true },
  betAmount: { type: Number, required: true },
  winAmount: { type: Number, required: true },
  reelSymbols: { type: [[String]], required: true },
  balanceAfter: { type: Number, required: true },
  tier: { type: String, enum: ["BIG WIN", "MEGA WIN", "JACKPOT", null], default: null },
  forced: { type: Boolean, required: true, default: false },
  forcedOutcomeId: { type: Schema.Types.ObjectId, ref: "ForcedOutcome", default: null },
  createdAt: { type: Date, default: () => new Date(), index: true },
});

export const SpinHistory = model<ISpinHistory>("SpinHistory", spinHistorySchema);
