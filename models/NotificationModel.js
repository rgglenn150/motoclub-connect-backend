import mongoose from 'mongoose';
const { Schema } = mongoose;

/**
 * Notification Schema for tracking user notifications
 * Handles join requests, approvals, rejections, new members, and role changes
 */
const notificationSchema = new Schema(
  {
    type: {
      type: String,
      required: true,
      enum: [
        'join_request',
        'request_approved', 
        'request_rejected',
        'new_member',
        'role_change'
      ],
    },
    recipient: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true, // Index for efficient queries by recipient
    },
    sender: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null, // Optional - not all notifications have a sender
    },
    club: {
      type: Schema.Types.ObjectId,
      ref: 'Club',
      required: true,
      index: true, // Index for efficient queries by club
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    data: {
      type: Schema.Types.Mixed,
      default: {}, // Additional data like joinRequestId, etc.
    },
    read: {
      type: Boolean,
      default: false,
      index: true, // Index for efficient unread queries
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from creation
      index: { expireAfterSeconds: 0 }, // TTL index for auto-deletion
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
  }
);

// Compound indexes for common query patterns
notificationSchema.index({ recipient: 1, createdAt: -1 }); // Get user notifications sorted by date
notificationSchema.index({ recipient: 1, read: 1 }); // Get unread notifications for user
notificationSchema.index({ club: 1, type: 1 }); // Get notifications by club and type

/**
 * Static method to create a notification
 */
notificationSchema.statics.createNotification = async function(notificationData) {
  try {
    const notification = new this(notificationData);
    return await notification.save();
  } catch (error) {
    throw new Error(`Failed to create notification: ${error.message}`);
  }
};

/**
 * Static method to get paginated notifications for a user
 */
notificationSchema.statics.getNotificationsForUser = async function(userId, page = 1, limit = 20) {
  try {
    const skip = (page - 1) * limit;
    
    const notifications = await this.find({ recipient: userId })
      .populate('sender', 'username firstName lastName')
      .populate('club', 'clubName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await this.countDocuments({ recipient: userId });

    return {
      notifications,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      },
    };
  } catch (error) {
    throw new Error(`Failed to get notifications: ${error.message}`);
  }
};

/**
 * Static method to get unread count for a user
 */
notificationSchema.statics.getUnreadCount = async function(userId) {
  try {
    return await this.countDocuments({ recipient: userId, read: false });
  } catch (error) {
    throw new Error(`Failed to get unread count: ${error.message}`);
  }
};

/**
 * Static method to mark all notifications as read for a user
 */
notificationSchema.statics.markAllAsRead = async function(userId) {
  try {
    const result = await this.updateMany(
      { recipient: userId, read: false },
      { read: true }
    );
    return result.modifiedCount;
  } catch (error) {
    throw new Error(`Failed to mark all as read: ${error.message}`);
  }
};

export default mongoose.model('Notification', notificationSchema);