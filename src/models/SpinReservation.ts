import { Schema, model, Document, Types } from "mongoose";

/**
 * A pre-computed spin result held server-side for one (userId, gameId), so the real
 * `/spin` request can redeem it instantly instead of drawing a fresh result live — see
 * that game's routes.ts. Created by the `/spin/reserve` endpoint right after the previous
 * spin lands (or on load/bet-change), consumed exactly once via findOneAndDelete, and
 * otherwise self-expires via the TTL index below so an unused reservation never lingers.
 * At most one active reservation per (userId, gameId) — a new reserve call for the same
 * user+game atomically replaces any existing one (see the unique index).
 */
export interface ISpinReservation extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  gameId: string;
  betAmount: number;
  result: unknown;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const spinReservationSchema = new Schema<ISpinReservation>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    gameId: { type: String, required: true },
    betAmount: { type: Number, required: true },
    result: { type: Schema.Types.Mixed, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

spinReservationSchema.index({ userId: 1, gameId: 1 }, { unique: true });
spinReservationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const SpinReservation = model<ISpinReservation>("SpinReservation", spinReservationSchema);
