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
    scope: {
      type: String,
      enum: ['club', 'global'],
      default: 'club',
      index: true,
    },
    club: {
      type: Schema.Types.ObjectId,
      ref: 'Club',
      required: function () {
        return this.scope === 'club';
      },
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    attendees: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    attendeeCount: {
      type: Number,
      default: 0,
    },
    maxAttendees: {
      type: Number,
      default: null,
    },
    joinPolicy: {
      type: String,
      enum: ['instant'],
      default: 'instant',
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
  'geolocation.longitude': 1,
});

// Compound index for global event feed queries
eventSchema.index({ scope: 1, startTime: 1 });

export default mongoose.model('Event', eventSchema);
