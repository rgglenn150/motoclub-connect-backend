import mongoose from 'mongoose';
const { Schema } = mongoose;

const officialMemberSchema = new Schema(
  {
    club: {
      type: Schema.Types.ObjectId,
      ref: 'Club',
      required: true,
      index: true,
    },
    officialNumber: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 20,
    },
    firstName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },
    lastName: {
      type: String,
      required: false,
      trim: true,
      maxlength: 50,
      default: '',
    },
    address: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    plateNumber: {
      type: String,
      trim: true,
      maxlength: 20,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    metadata: {
      type: Map,
      of: Schema.Types.Mixed,
      default: new Map(),
    },
    photoUrl: {
      type: String,
    },
    photoPublicId: {
      type: String,
    },
    claimedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    claimedAt: {
      type: Date,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false, // We handle timestamps manually
  }
);

// Compound index to ensure official number is unique per club
officialMemberSchema.index({ club: 1, officialNumber: 1 }, { unique: true });

// Index for querying active members by club
officialMemberSchema.index({ club: 1, isActive: 1 });

// Index for querying claimed members by club
officialMemberSchema.index({ club: 1, claimedBy: 1 });

// Pre-save middleware to update the updatedAt field
officialMemberSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

// Static method to check if an official number is available
officialMemberSchema.static(
  'isOfficialNumberAvailable',
  async function (clubId, officialNumber, excludeId = null) {
    const query = {
      club: clubId,
      officialNumber: officialNumber,
    };

    // If excluding an ID (for updates), add it to the query
    if (excludeId) {
      query._id = { $ne: excludeId };
    }

    const existingMember = await this.findOne(query);
    return !existingMember; // Returns true if available, false if taken
  }
);

export default mongoose.model('OfficialMember', officialMemberSchema);
