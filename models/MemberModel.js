import mongoose from 'mongoose';
const { Schema } = mongoose;

const memberSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  club: { type: Schema.Types.ObjectId, ref: 'Club', required: true },
  roles: {
    type: [String],
    enum: ['member', 'admin'],
    default: ['member'],
  },
  joinedDate: { type: Date, default: Date.now },
});

// Add a compound index to ensure a user can only be a member of a club once
memberSchema.index({ user: 1, club: 1 }, { unique: true });

export default mongoose.model('Member', memberSchema);
