import mongoose from 'mongoose';
const { Schema } = mongoose;

/**
 * Defines the main schema for a Club.
 * This version now references an external 'Member' model.
 */
const clubSchema = new Schema(
  {
    clubName: {
      type: String,
      required: true,
      trim: true, // Removes whitespace from both ends
      unique: true, // Ensures club names are unique
    },
    // Standardized to lowercase 'description' to match controller
    description: {
      type: String,
      required: true,
      trim: true,
    },
    // Text location description
    location: {
      type: String,
      trim: true,
    },
    // Legacy geolocation format (kept for backward compatibility)
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
    // New GeoJSON format for efficient geospatial queries
    geoPoint: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        validate: {
          validator: function(coords) {
            return coords.length === 2 &&
              coords[0] >= -180 && coords[0] <= 180 && // longitude
              coords[1] >= -90 && coords[1] <= 90;     // latitude
          },
          message: 'Coordinates must be [longitude, latitude] with valid ranges'
        }
      }
    },
    isPrivate: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User', // References the User who created the club
      required: true,
    },
    // The members array now stores references to documents in the 'Member' collection.
    members: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Member',
      },
    ],
    joinRequests: [
      {
        type: Schema.Types.ObjectId,
        ref: 'JoinRequest',
      },
    ],
    // Optional logo fields stored in Cloudinary
    logoUrl: {
      type: String,
      default: undefined,
    },
    logoPublicId: {
      type: String,
      default: undefined,
    },
  },
  {
    // Automatically adds createdAt and updatedAt fields
    timestamps: true,
  }
);

// Pre-save middleware to sync geolocation data between legacy and GeoJSON formats
clubSchema.pre('save', function(next) {
  // If legacy geolocation exists and has valid coordinates
  if (this.geolocation &&
      typeof this.geolocation.latitude === 'number' &&
      typeof this.geolocation.longitude === 'number' &&
      this.geolocation.latitude >= -90 && this.geolocation.latitude <= 90 &&
      this.geolocation.longitude >= -180 && this.geolocation.longitude <= 180) {

    // Create or update geoPoint from legacy geolocation
    this.geoPoint = {
      type: 'Point',
      coordinates: [this.geolocation.longitude, this.geolocation.latitude]
    };
  } else if (this.geoPoint &&
             this.geoPoint.coordinates &&
             Array.isArray(this.geoPoint.coordinates) &&
             this.geoPoint.coordinates.length === 2) {

    // Create or update legacy geolocation from geoPoint
    const [longitude, latitude] = this.geoPoint.coordinates;
    if (!this.geolocation) {
      this.geolocation = {};
    }
    this.geolocation.latitude = latitude;
    this.geolocation.longitude = longitude;
  }

  next();
});

// Pre-update middleware to sync geolocation data for updates
clubSchema.pre(['updateOne', 'findOneAndUpdate'], function(next) {
  const update = this.getUpdate();

  // Handle $set operations
  if (update.$set) {
    // If updating legacy geolocation, sync to geoPoint
    if (update.$set.geolocation &&
        update.$set.geolocation.latitude &&
        update.$set.geolocation.longitude) {
      update.$set.geoPoint = {
        type: 'Point',
        coordinates: [update.$set.geolocation.longitude, update.$set.geolocation.latitude]
      };
    }

    // If updating geoPoint, sync to legacy geolocation
    if (update.$set.geoPoint &&
        update.$set.geoPoint.coordinates &&
        Array.isArray(update.$set.geoPoint.coordinates) &&
        update.$set.geoPoint.coordinates.length === 2) {
      const [longitude, latitude] = update.$set.geoPoint.coordinates;
      update.$set['geolocation.latitude'] = latitude;
      update.$set['geolocation.longitude'] = longitude;
    }
  }

  next();
});

// Create a 2dsphere index for efficient geospatial queries
clubSchema.index({ 'geoPoint': '2dsphere' });

// Additional compound indexes for performance optimization
clubSchema.index({
  'isPrivate': 1,
  'geoPoint': '2dsphere'
});

// Note: Legacy 'geolocation' field is NOT indexed as 2dsphere because it's not in GeoJSON format.
// The geoPoint field is used for all geospatial queries and is properly indexed.
// The legacy geolocation field is kept only for backward compatibility.

export default mongoose.model('Club', clubSchema);
