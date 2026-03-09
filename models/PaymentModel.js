import mongoose from 'mongoose';
const { Schema } = mongoose;

const paymentSchema = new Schema({
  collection:      { type: Schema.Types.ObjectId, ref: 'Collection', required: true, index: true },
  club:            { type: Schema.Types.ObjectId, ref: 'Club', required: true, index: true },
  name:            { type: String, required: true, trim: true },
  amount:          { type: Number, required: true },
  referenceNumber: { type: String, required: true, trim: true },
  phoneNumber:     { type: String, trim: true },
  description:     { type: String, trim: true },
  transactionDate: { type: Date },
  receiptUrl:      { type: String },
  receiptPublicId: { type: String },
  createdBy:       { type: Schema.Types.ObjectId, ref: 'User', required: true },
  status:          { type: String, enum: ['pending', 'confirmed', 'rejected'], default: 'pending' },
}, { timestamps: true });

export default mongoose.model('Payment', paymentSchema);
