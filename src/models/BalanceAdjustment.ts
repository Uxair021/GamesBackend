import { Schema, model, Document, Types } from "mongoose";

export interface IBalanceAdjustment extends Document {
  userId: Types.ObjectId;
  previousBalance: number;
  newBalance: number;
  delta: number;
  createdBy: Types.ObjectId;
  createdAt: Date;
}

const balanceAdjustmentSchema = new Schema<IBalanceAdjustment>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  previousBalance: { type: Number, required: true },
  newBalance: { type: Number, required: true },
  delta: { type: Number, required: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  createdAt: { type: Date, default: () => new Date() },
});

balanceAdjustmentSchema.index({ userId: 1, createdAt: -1 });

export const BalanceAdjustment = model<IBalanceAdjustment>("BalanceAdjustment", balanceAdjustmentSchema);
