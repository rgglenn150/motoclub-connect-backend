import mongoose from 'mongoose';
const { Schema } = mongoose;

// A handover of collected money (spec 009). Only moves active → voided
// (constitution VII); it is never edited or deleted on its own.
const remittanceSchema = new Schema({
  collection:       { type: Schema.Types.ObjectId, ref: 'Collection', required: true },
  club:             { type: Schema.Types.ObjectId, ref: 'Club', required: true, index: true },
  amount:           { type: Number, required: true },
  // Calendar date YYYY-MM-DD, so it can't shift a day across timezones (research R3).
  remittedOn:       { type: String, required: true },
  recipientType:    { type: String, enum: ['member', 'external'], required: true },
  member:           { type: Schema.Types.ObjectId, ref: 'Member' },
  recipientUser:    { type: Schema.Types.ObjectId, ref: 'User' },
  // Snapshot of the member's name when recorded, or the external party's name (D12).
  recipientName:    { type: String, required: true, trim: true },
  recipientAccount: { type: String, trim: true },
  note:             { type: String, trim: true },
  visibility:       { type: String, enum: ['admins', 'members', 'public'], default: 'members' },
  proofUrl:         { type: String },
  proofPublicId:    { type: String },
  recordedBy:       { type: Schema.Types.ObjectId, ref: 'User', required: true },
  status:           { type: String, enum: ['active', 'voided'], default: 'active' },
  voidedBy:         { type: Schema.Types.ObjectId, ref: 'User' },
  voidedAt:         { type: Date },
  voidReason:       { type: String, trim: true },
}, { timestamps: true, suppressReservedKeysWarning: true });

remittanceSchema.index({ collection: 1, status: 1 });

export default mongoose.model('Remittance', remittanceSchema);
