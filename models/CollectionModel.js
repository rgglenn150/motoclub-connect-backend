import mongoose from 'mongoose';
const { Schema } = mongoose;

const collectionSchema = new Schema({
  club:         { type: Schema.Types.ObjectId, ref: 'Club', required: true, index: true },
  name:         { type: String, required: true, trim: true },
  description:  { type: String, trim: true },
  targetAmount: { type: Number },
  status:       { type: String, enum: ['open', 'closed'], default: 'open' },
  createdBy:    { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true, suppressReservedKeysWarning: true });

collectionSchema.index({ club: 1, createdAt: -1 });

export default mongoose.model('Collection', collectionSchema);
