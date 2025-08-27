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
    // Added missing fields to match the data being sent from the frontend
    location: {
      type: String,
      trim: true,
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

export default mongoose.model('Club', clubSchema);
