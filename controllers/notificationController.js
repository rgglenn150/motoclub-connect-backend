import Notification from '../models/NotificationModel.js';
import { validationResult } from 'express-validator';

export {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getUnreadCount,
};

/**
 * GET /api/notifications - Get user's notifications with pagination
 */
async function getNotifications(req, res) {
  try {
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50); // Cap at 50 notifications per page

    if (page < 1 || limit < 1) {
      return res.status(400).json({ 
        message: 'Page and limit must be positive numbers' 
      });
    }

    const result = await Notification.getNotificationsForUser(userId, page, limit);

    // Format response to match required structure
    const formattedNotifications = result.notifications.map(notification => ({
      _id: notification._id,
      type: notification.type,
      message: notification.message,
      club: notification.club ? {
        _id: notification.club._id,
        name: notification.club.clubName,
      } : null,
      sender: notification.sender ? {
        _id: notification.sender._id,
        name: notification.sender.username || 
              (notification.sender.firstName && notification.sender.lastName ? 
                `${notification.sender.firstName} ${notification.sender.lastName}` : 
                'Unknown User'),
      } : null,
      read: notification.read,
      createdAt: notification.createdAt,
      data: notification.data,
    }));

    return res.status(200).json({
      notifications: formattedNotifications,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error('Error getting notifications:', error);
    return res.status(500).json({
      message: 'Server error',
      error: error?.message || error,
    });
  }
}

/**
 * PUT /api/notifications/:notificationId/read - Mark specific notification as read
 */
async function markAsRead(req, res) {
  try {
    const { notificationId } = req.params;
    const userId = req.user._id;

    // Validate notification ID format
    if (!notificationId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: 'Invalid notification ID format' });
    }

    // Find and update the notification (ensure it belongs to the user)
    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, recipient: userId },
      { read: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ 
        message: 'Notification not found or does not belong to you' 
      });
    }

    return res.status(200).json({
      message: 'Notification marked as read',
      notification: {
        _id: notification._id,
        read: notification.read,
      },
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    return res.status(500).json({
      message: 'Server error',
      error: error?.message || error,
    });
  }
}

/**
 * PUT /api/notifications/mark-all-read - Mark all user notifications as read
 */
async function markAllAsRead(req, res) {
  try {
    const userId = req.user._id;

    const modifiedCount = await Notification.markAllAsRead(userId);

    return res.status(200).json({
      message: 'All notifications marked as read',
      modifiedCount,
    });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    return res.status(500).json({
      message: 'Server error',
      error: error?.message || error,
    });
  }
}

/**
 * DELETE /api/notifications/:notificationId - Delete specific notification
 */
async function deleteNotification(req, res) {
  try {
    const { notificationId } = req.params;
    const userId = req.user._id;

    // Validate notification ID format
    if (!notificationId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: 'Invalid notification ID format' });
    }

    // Find and delete the notification (ensure it belongs to the user)
    const notification = await Notification.findOneAndDelete({
      _id: notificationId,
      recipient: userId,
    });

    if (!notification) {
      return res.status(404).json({ 
        message: 'Notification not found or does not belong to you' 
      });
    }

    return res.status(200).json({
      message: 'Notification deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting notification:', error);
    return res.status(500).json({
      message: 'Server error',
      error: error?.message || error,
    });
  }
}

/**
 * GET /api/notifications/unread-count - Get count of unread notifications
 */
async function getUnreadCount(req, res) {
  try {
    const userId = req.user._id;

    const unreadCount = await Notification.getUnreadCount(userId);

    return res.status(200).json({
      unreadCount,
    });
  } catch (error) {
    console.error('Error getting unread count:', error);
    return res.status(500).json({
      message: 'Server error',
      error: error?.message || error,
    });
  }
}