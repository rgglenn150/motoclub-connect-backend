import Notification from '../models/NotificationModel.js';
import User from '../models/UserModel.js';
import Member from '../models/MemberModel.js';

/**
 * Message templates for different notification types
 */
const messageTemplates = {
  join_request: (senderName, clubName) => `${senderName} wants to join ${clubName}`,
  request_approved: (clubName, approverName) => `Your request to join ${clubName} was approved by ${approverName}`,
  request_rejected: (clubName, rejecterName) => `Your request to join ${clubName} was rejected by ${rejecterName}`,
  new_member: (memberName, clubName) => `${memberName} joined ${clubName}`,
  role_change: (clubName) => `You are now an admin of ${clubName}`,
};

/**
 * Helper function to get user display name
 */
function getUserDisplayName(user) {
  return user.username || 
         (user.firstName && user.lastName ? 
           `${user.firstName} ${user.lastName}` : 
           'Unknown User');
}

/**
 * Create notification for club join request (notify all admins)
 * @param {Array} clubAdmins - Array of admin user IDs
 * @param {Object} requesterUser - User who made the join request
 * @param {Object} club - Club object
 * @param {String} joinRequestId - ID of the join request
 */
export async function createJoinRequestNotification(clubAdmins, requesterUser, club, joinRequestId) {
  try {
    const senderName = getUserDisplayName(requesterUser);
    const message = messageTemplates.join_request(senderName, club.clubName);

    // Create notifications for all club admins
    const notificationPromises = clubAdmins.map(adminId => 
      Notification.createNotification({
        type: 'join_request',
        recipient: adminId,
        sender: requesterUser._id,
        club: club._id,
        message,
        data: {
          joinRequestId,
          requesterUserId: requesterUser._id,
          requesterName: senderName,
        },
      })
    );

    const notifications = await Promise.all(notificationPromises);
    console.log(`Created ${notifications.length} join request notifications for club ${club.clubName}`);
    
    return notifications;
  } catch (error) {
    console.error('Error creating join request notifications:', error);
    throw new Error(`Failed to create join request notifications: ${error.message}`);
  }
}

/**
 * Create notification for approved join request (notify requester)
 * @param {String} requesterUserId - ID of user who made the request
 * @param {Object} club - Club object
 * @param {Object} approverUser - User who approved the request
 */
export async function createRequestApprovedNotification(requesterUserId, club, approverUser) {
  try {
    const approverName = getUserDisplayName(approverUser);
    const message = messageTemplates.request_approved(club.clubName, approverName);

    const notification = await Notification.createNotification({
      type: 'request_approved',
      recipient: requesterUserId,
      sender: approverUser._id,
      club: club._id,
      message,
      data: {
        approverUserId: approverUser._id,
        approverName,
      },
    });

    console.log(`Created approval notification for user ${requesterUserId} in club ${club.clubName}`);
    return notification;
  } catch (error) {
    console.error('Error creating approval notification:', error);
    throw new Error(`Failed to create approval notification: ${error.message}`);
  }
}

/**
 * Create notification for rejected join request (notify requester)
 * @param {String} requesterUserId - ID of user who made the request
 * @param {Object} club - Club object
 * @param {Object} rejecterUser - User who rejected the request
 */
export async function createRequestRejectedNotification(requesterUserId, club, rejecterUser) {
  try {
    const rejecterName = getUserDisplayName(rejecterUser);
    const message = messageTemplates.request_rejected(club.clubName, rejecterName);

    const notification = await Notification.createNotification({
      type: 'request_rejected',
      recipient: requesterUserId,
      sender: rejecterUser._id,
      club: club._id,
      message,
      data: {
        rejecterUserId: rejecterUser._id,
        rejecterName,
      },
    });

    console.log(`Created rejection notification for user ${requesterUserId} in club ${club.clubName}`);
    return notification;
  } catch (error) {
    console.error('Error creating rejection notification:', error);
    throw new Error(`Failed to create rejection notification: ${error.message}`);
  }
}

/**
 * Create notification for new member joining (notify all existing members except the new member)
 * @param {Array} clubMemberIds - Array of existing member IDs (Member model IDs)
 * @param {Object} newMember - New member object
 * @param {Object} club - Club object
 */
export async function createNewMemberNotification(clubMemberIds, newMember, club) {
  try {
    // Get user IDs from Member records, excluding the new member
    const members = await Member.find({ 
      _id: { $in: clubMemberIds },
      _id: { $ne: newMember._id } // Exclude the new member
    }).populate('club');

    if (members.length === 0) {
      console.log('No existing members to notify for new member join');
      return [];
    }

    // Get User IDs from email addresses (using existing logic pattern)
    const userEmails = members.map(member => member.email);
    const users = await User.find({ email: { $in: userEmails } });
    const userIds = users.map(user => user._id);

    const message = messageTemplates.new_member(newMember.name, club.clubName);

    // Create notifications for all existing members
    const notificationPromises = userIds.map(userId => 
      Notification.createNotification({
        type: 'new_member',
        recipient: userId,
        sender: null, // No specific sender for this type
        club: club._id,
        message,
        data: {
          newMemberName: newMember.name,
          newMemberId: newMember._id,
        },
      })
    );

    const notifications = await Promise.all(notificationPromises);
    console.log(`Created ${notifications.length} new member notifications for club ${club.clubName}`);
    
    return notifications;
  } catch (error) {
    console.error('Error creating new member notifications:', error);
    throw new Error(`Failed to create new member notifications: ${error.message}`);
  }
}

/**
 * Create notification for role change (notify the user whose role changed)
 * @param {String} userId - ID of user whose role changed
 * @param {Object} club - Club object
 * @param {String} newRole - New role assigned
 * @param {Object} changerUser - User who made the role change
 */
export async function createRoleChangeNotification(userId, club, newRole, changerUser) {
  try {
    const message = messageTemplates.role_change(club.clubName);

    const notification = await Notification.createNotification({
      type: 'role_change',
      recipient: userId,
      sender: changerUser._id,
      club: club._id,
      message,
      data: {
        newRole,
        changerUserId: changerUser._id,
        changerName: getUserDisplayName(changerUser),
      },
    });

    console.log(`Created role change notification for user ${userId} in club ${club.clubName}`);
    return notification;
  } catch (error) {
    console.error('Error creating role change notification:', error);
    throw new Error(`Failed to create role change notification: ${error.message}`);
  }
}

/**
 * Helper function to get all admin user IDs for a club
 * @param {String} clubId - Club ID
 * @returns {Array} Array of admin user IDs
 */
export async function getClubAdmins(clubId) {
  try {
    // Find all admin members of the club
    const adminMembers = await Member.find({ 
      club: clubId, 
      roles: 'admin' 
    });

    if (adminMembers.length === 0) {
      return [];
    }

    // Get user IDs from email addresses (using existing logic pattern)
    const adminEmails = adminMembers.map(member => member.email);
    const adminUsers = await User.find({ email: { $in: adminEmails } });
    
    return adminUsers.map(user => user._id);
  } catch (error) {
    console.error('Error getting club admins:', error);
    throw new Error(`Failed to get club admins: ${error.message}`);
  }
}