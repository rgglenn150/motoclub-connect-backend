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
      required: false, // End time is optional
    },
    location: {
      type: String,
      trim: true,
    },
    geolocation: {
      latitude: {
        type: Number,
        min: -90,
        max: 90,
      },
      longitude: {
        type: Number,
        min: -180,
        max: 180,
      },
      placeName: {
        type: String,
        trim: true,
      },
    },
    eventType: {
      type: String,
      enum: ['ride', 'meeting', 'meetup', 'event'],
      default: 'event',
    },
    isPrivate: {
      type: Boolean,
      default: true,
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

// Create a 2dsphere index for geospatial queries (if geolocation exists)
eventSchema.index({
  'geolocation.latitude': 1,
  'geolocation.longitude': 1
});

export default mongoose.model('Event', eventSchema);
