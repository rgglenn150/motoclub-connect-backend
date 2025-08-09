import mongoose from 'mongoose';
const { Schema } = mongoose;

const memberSchema = new Schema({
  name: { type: String, required: true },
  // Removing unique constraint to allow the same user email to be in multiple clubs
  email: { type: String, required: true },
  club: { type: Schema.Types.ObjectId, ref: 'Club', required: true },
  roles: {
    type: [String],
    enum: ['member', 'admin'],
    default: ['member'],
  },
  joinedDate: { type: Date, default: Date.now },
});

export default mongoose.model('Member', memberSchema);
