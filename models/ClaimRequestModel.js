import mongoose from 'mongoose';
const { Schema } = mongoose;

const claimRequestSchema = new Schema({
  officialMember: {
    type: Schema.Types.ObjectId,
    ref: 'OfficialMember',
    required: true,
    index: true,
  },
  club: {
    type: Schema.Types.ObjectId,
    ref: 'Club',
    required: true,
    index: true,
  },
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    index: true,
  },
  verificationNotes: {
    type: String,
    trim: true,
    maxlength: 500,
  },
  responseNotes: {
    type: String,
    trim: true,
    maxlength: 500,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  processedAt: {
    type: Date,
  },
});

// Add compound indexes for efficient queries
claimRequestSchema.index({ club: 1, status: 1 });
claimRequestSchema.index({ user: 1, status: 1 });
claimRequestSchema.index({ officialMember: 1, status: 1 });

// Add compound unique index with partial filter to ensure one pending claim per member per user
claimRequestSchema.index(
  { officialMember: 1, user: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'pending' },
  }
);

export default mongoose.model('ClaimRequest', claimRequestSchema);
