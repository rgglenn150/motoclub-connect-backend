import mongoose from 'mongoose';
const { Schema } = mongoose;

const eventSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    startTime: {
      type: Date,
      required: true,
    },
    endTime: {
      type: Date,
      required: true,
    },
    location: {
      type: String,
      trim: true,
    },
    eventType: {
      type: String,
      enum: ['ride', 'meeting', 'meetup', 'event'],
      default: 'event',
    },
    club: {
      type: Schema.Types.ObjectId,
      ref: 'Club',
      required: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Optional image fields stored in Cloudinary
    imageUrl: {
      type: String,
      default: undefined,
    },
    imagePublicId: {
      type: String,
      default: undefined,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model('Event', eventSchema);
