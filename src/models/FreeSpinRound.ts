import { Schema, model, Document, Types } from "mongoose";

/**
 * Server-side pointer to a user's currently-active free-spin bonus round — Life of Luxury only,
 * for its end-of-round "total win × (wilds seen + 1)" payout (see games/LifeOfLuxury/routes.ts).
 * Free spins are otherwise stateless per request (see every other game's engine.ts), but that
 * multiplier has to be a real, tamper-proof credit, not a number the client reports — so this
 * tracks wildCount/totalWin server-side across the round's requests. Also doubles as the
 * authoritative source for whether a given spin request is really a free spin at all: routes.ts
 * derives isFreeSpin from this record's existence/remaining rather than trusting the client's own
 * isFreeSpin flag, closing the hole where a client could just claim every spin is free.
 * Deleted once the round finishes (see routes.ts) — there is at most one active row per
 * (userId, gameId) at a time.
 */
export interface IFreeSpinRound extends Document {
  userId: Types.ObjectId;
  gameId: string;
  betAmount: number;
  totalSpins: number;
  remaining: number;
  wildCount: number;
  totalWin: number;
  createdAt: Date;
  updatedAt: Date;
}

const freeSpinRoundSchema = new Schema<IFreeSpinRound>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    gameId: { type: String, required: true },
    betAmount: { type: Number, required: true },
    totalSpins: { type: Number, required: true },
    remaining: { type: Number, required: true },
    wildCount: { type: Number, required: true, default: 0 },
    totalWin: { type: Number, required: true, default: 0 },
  },
  { timestamps: true }
);
freeSpinRoundSchema.index({ userId: 1, gameId: 1 }, { unique: true });

export const FreeSpinRound = model<IFreeSpinRound>("FreeSpinRound", freeSpinRoundSchema);
