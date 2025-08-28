import Club from '../models/ClubModel.js';
import Member from '../models/MemberModel.js';
import JoinRequest from '../models/JoinRequest.js';
import User from '../models/UserModel.js';
import { validationResult } from 'express-validator';
import cloudinary from '../utils/cloudinary.js';
import { 
  createJoinRequestNotification,
  createRequestApprovedNotification,
  createRequestRejectedNotification,
  createNewMemberNotification,
  getClubAdmins,
} from '../utils/notificationService.js';

export {
  createClub,
  addMember,
  getAllClubs,
  getClubById,
  joinClub,
  uploadClubLogo,
  getMembershipStatus,
  getJoinRequests,
  approveJoinRequest,
  rejectJoinRequest,
  removeMember,
  getClubMembers,
};

/**
 * GET /api/club/:clubId/members - Get all club members (admin only)
 */
async function getClubMembers(req, res) {
  try {
    const { clubId } = req.params;
    const userId = req.user._id;

    // Validate clubId format
    if (!clubId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: 'Invalid club ID format' });
    }

    // Verify club exists
    const club = await Club.findById(clubId);
    if (!club) {
      return res.status(404).json({ message: 'Club not found' });
    }

    // Verify user is admin of this club
    const adminCheck = await verifyClubAdmin(userId, clubId);
    if (!adminCheck.isAdmin) {
      return res.status(403).json({ message: adminCheck.error });
    }

    // Get all members for the club, populating the user's details
    const members = await Member.find({ club: clubId }).populate('user', 'username email firstName lastName profilePicture');

    // Format the response to match what the frontend expects
    const formattedMembers = members.map(member => ({
      _id: member._id,
      user: {
        _id: member.user._id,
        name: member.user.username || `${member.user.firstName} ${member.user.lastName}`.trim() || 'Unnamed User',
        email: member.user.email,
        profilePicture: member.user.profilePicture,
      },
      club: member.club,
      role: member.roles.includes('admin') ? 'admin' : 'member',
      joinedAt: member.joinedDate,
    }));

    return res.status(200).json(formattedMembers);
  } catch (error) {
    console.error('Error getting club members:', error);
    return res.status(500).json({
      message: 'Server error',
      error: error?.message || error,
    });
  }
}

async function createClub(req, res) {
  // 1. Validate incoming data
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    // If there are validation errors, return a 400 Bad Request response
    return res.status(400).json({
      errors: errors.array(),
    });
  }

  // 2. Destructure sanitized data from the request body
  const { name, description, location, isPrivate } = req.body;

  try {
    // 3. Get the full user data to access email and username
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    // 4. Check if a club with the same name already exists
    const existingClub = await Club.findOne({
      clubName: name,
    });
    if (existingClub) {
      return res.status(400).json({
        msg: 'A club with this name already exists.',
      });
    }

    // 5. Create a new Club instance without any initial members
    const newClub = new Club({
      clubName: name, // Use 'name' from body for 'clubName' field
      description,
      location,
      isPrivate,
      createdBy: req.user._id, // Correctly reference the user's _id
      // members property is omitted to allow the schema's default (empty array)
    });

    // 6. Create and add the creator as an admin member of this club
    const creatorMember = new Member({
      user: req.user._id,
      club: newClub._id,
      roles: ['member', 'admin'],
    });
    await creatorMember.save();
    console.log('New member created:', creatorMember);
    newClub.members.push(creatorMember._id);

    // 7. Save the new club to the database
    await newClub.save();
    console.log('Club updated with new member:', newClub);

    // 8. Respond with the newly created club data
    res.status(201).json(newClub);
  } catch (err) {
    // 9. Graceful error handling
    console.error(err.message);
    res.status(500).send('Server Error');
  }
}

async function addMember(req, res) {
  try {
    const { clubId, memberData } = req.body;

    // Find the club by ID
    const club = await Club.findById(clubId);
    if (!club) {
      return res.status(404).json({
        message: 'Club not found',
      });
    }

    // Create a new member
    const member = new Member(memberData);
    await member.save();

    // Add the member to the club
    club.members.push(member._id);
    await club.save();

    res.status(201).json({
      message: 'Member added successfully',
      member,
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error adding member',
      error,
    });
  }
}

async function getAllClubs(req, res) {
  const clubs = await Club.find();
  const clubsWithId = clubs.map((club) => ({
    id: club._id,
    clubName: club.clubName,
    description: club.description,
    location: club.location,
    isPrivate: club.isPrivate,
    members: club.members,
    createdBy: club.createdBy,
    createdAt: club.createdAt,
    logoUrl: club.logoUrl,
  }));

  res.status(200).json({
    message: 'Get all clubs ',
    clubs: clubsWithId,
  });
}

async function getClubById(req, res) {
  try {
    const club = await Club.findById(req.params.id).populate(
      'members',
      'username'
    );
    if (!club) {
      return res.status(404).json({ msg: 'Club not found' });
    }
    console.log('rgdb club id : ', club);
    res.json(club);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
}

async function joinClub(req, res) {
  try {
    const { clubId } = req.params;
    const userId = req.user._id;

    // Get the full user data to access email
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Find and validate club exists
    const club = await Club.findById(clubId);
    if (!club) {
      return res.status(404).json({ message: 'Club not found' });
    }

    // Check if user is already a member (prevent duplicates)
    const existingMember = await Member.findOne({ club: clubId, user: userId });
    if (existingMember) {
      return res.status(400).json({ message: 'You are already a member of this club' });
    }

    // Check club privacy
    if (!club.isPrivate) {
      // Public club - instant join
      const newMember = new Member({
        user: userId,
        club: clubId,
        roles: ['member'],
      });

      await newMember.save();

      // Add member to club.members array
      club.members.push(newMember._id);
      await club.save();

      // Create notifications for existing members about the new member
      try {
        if (club.members.length > 1) { // Only notify if there are other members
          await createNewMemberNotification(club.members, newMember, club);
        }
      } catch (notificationError) {
        console.error('Failed to create new member notifications:', notificationError);
        // Don't fail the request if notification fails
      }

      return res.status(201).json({
        message: 'Successfully joined club',
        membership: newMember,
        instant: true,
      });
    } else {
      // Private club - request-based join (existing logic)
      const existingRequest = await JoinRequest.findOne({
        user: userId,
        club: clubId,
      });
      if (existingRequest) {
        return res
          .status(400)
          .json({ message: 'You have already requested to join this club' });
      }

      const newJoinRequest = new JoinRequest({
        user: userId,
        club: clubId,
      });

      await newJoinRequest.save();

      club.joinRequests.push(newJoinRequest._id);
      await club.save();

      // Create notifications for club admins about the join request
      try {
        const clubAdmins = await getClubAdmins(clubId);
        if (clubAdmins.length > 0) {
          await createJoinRequestNotification(clubAdmins, user, club, newJoinRequest._id);
        }
      } catch (notificationError) {
        console.error('Failed to create join request notifications:', notificationError);
        // Don't fail the request if notification fails
      }

      return res.status(201).json({
        message: 'Join request sent successfully',
        joinRequest: newJoinRequest,
        instant: false,
      });
    }
  } catch (error) {
    console.error('Error joining club:', error);
    res.status(500).json({ message: 'Error joining club', error: error?.message || error });
  }
}

/**
 * Uploads a club logo image to Cloudinary and stores the resulting URL on the club.
 * Expects a multipart/form-data request with field name 'logo'.
 */
async function uploadClubLogo(req, res) {
  try {
    const { clubId } = req.params;

    if (!req.file) {
      return res
        .status(400)
        .json({ message: 'Logo file is required (field name: logo)' });
    }

    const club = await Club.findById(clubId);
    if (!club) {
      return res.status(404).json({ message: 'Club not found' });
    }

    // Convert buffer to data URI to avoid temp files
    const base64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

    const uploadResult = await cloudinary.uploader.upload(base64, {
      folder: 'motoclub-connect/clubs',
      public_id: `club_${clubId}_logo`,
      overwrite: true,
      resource_type: 'image',
      transformation: [{ width: 512, height: 512, crop: 'limit' }],
    });

    club.logoUrl = uploadResult.secure_url;
    club.logoPublicId = uploadResult.public_id;
    await club.save();

    return res.status(200).json({
      message: 'Club logo uploaded successfully',
      logoUrl: club.logoUrl,
      publicId: club.logoPublicId,
    });
  } catch (error) {
    console.error('Error uploading club logo:', error);
    return res
      .status(500)
      .json({
        message: 'Error uploading club logo',
        error: error?.message || error,
      });
  }
}

async function getMembershipStatus(req, res) {
  try {
    const { clubId } = req.params;
    const userId = req.user._id;
    console.log('Checking membership status for user:', userId, 'in club:', clubId);

    // Validate clubId format first
    if (!clubId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: 'Invalid club ID format' });
    }

    // Verify club exists
    const club = await Club.findById(clubId);
    if (!club) {
      return res.status(404).json({ message: 'Club not found' });
    }

    // Get the full user data to access email
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if user is a member of the club
    const member = await Member.findOne({ club: clubId, user: userId });
    console.log('Found member:', member);
    
    if (member) {
      // User is a member - check if they're admin
      const isAdmin = member.roles.includes('admin');
      const role = isAdmin ? 'admin' : 'member';
      
      // Define permissions based on role
      const permissions = isAdmin 
        ? ['view', 'post', 'manage', 'admin'] 
        : ['view', 'post'];
      
      return res.status(200).json({
        status: role,
        role: role,
        memberSince: member.joinedDate,
        permissions: permissions,
        memberId: member._id,
      });
    }

    // User is not a member - check for pending join request
    const joinRequest = await JoinRequest.findOne({
      club: clubId,
      user: userId,
      status: 'pending',
    });

    if (joinRequest) {
      return res.status(200).json({
        status: 'pending',
        joinRequestId: joinRequest._id,
        requestedAt: joinRequest.createdAt,
      });
    }

    // User is not a member and has no pending request
    return res.status(200).json({
      status: 'not-member',
    });
  } catch (error) {
    console.error('Error getting membership status:', error);
    return res.status(500).json({
      message: 'Server error',
      error: error?.message || error,
    });
  }
}

/**
 * Helper function to verify if user is admin of a specific club
 */
async function verifyClubAdmin(userId, clubId) {
  try {
    // Get user's email for Member lookup (consistent with existing logic)
    const user = await User.findById(userId);
    if (!user) {
      return { isAdmin: false, error: 'User not found' };
    }

    const member = await Member.findOne({ club: clubId, user: userId });
    
    if (!member) {
      return { isAdmin: false, error: 'User is not a member of this club' };
    }
    
    if (!member.roles.includes('admin')) {
      return { isAdmin: false, error: 'User does not have admin privileges' };
    }

    return { isAdmin: true, member };
  } catch (error) {
    return { isAdmin: false, error: 'Database error verifying admin status' };
  }
}

/**
 * GET /api/club/:clubId/join-requests - Get pending join requests (admin only)
 */
async function getJoinRequests(req, res) {
  try {
    const { clubId } = req.params;
    const userId = req.user._id;

    // Validate clubId format
    if (!clubId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: 'Invalid club ID format' });
    }

    // Verify club exists
    const club = await Club.findById(clubId);
    if (!club) {
      return res.status(404).json({ message: 'Club not found' });
    }

    // Verify user is admin of this club
    const adminCheck = await verifyClubAdmin(userId, clubId);
    if (!adminCheck.isAdmin) {
      return res.status(403).json({ message: adminCheck.error });
    }

    // Get pending join requests with user information populated
    const joinRequests = await JoinRequest.find({ 
      club: clubId, 
      status: 'pending' 
    }).populate('user', 'username email firstName lastName');

    // Format response to match required structure
    const formattedRequests = joinRequests.map(request => ({
      _id: request._id,
      user: {
        name: request.user.username || 
          (request.user.firstName && request.user.lastName ? 
            `${request.user.firstName} ${request.user.lastName}` : 
            'Unknown User'),
        email: request.user.email,
      },
      club: request.club,
      status: request.status,
      createdAt: request.createdAt,
    }));

    return res.status(200).json({
      joinRequests: formattedRequests,
    });
  } catch (error) {
    console.error('Error getting join requests:', error);
    return res.status(500).json({
      message: 'Server error',
      error: error?.message || error,
    });
  }
}

/**
 * POST /api/club/:clubId/join-requests/:requestId/approve - Approve join request
 */
async function approveJoinRequest(req, res) {
  try {
    const { clubId, requestId } = req.params;
    const userId = req.user._id;

    // Validate IDs format
    if (!clubId.match(/^[0-9a-fA-F]{24}$/) || !requestId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: 'Invalid ID format' });
    }

    // Verify club exists
    const club = await Club.findById(clubId);
    if (!club) {
      return res.status(404).json({ message: 'Club not found' });
    }

    // Verify user is admin of this club
    const adminCheck = await verifyClubAdmin(userId, clubId);
    if (!adminCheck.isAdmin) {
      return res.status(403).json({ message: adminCheck.error });
    }

    // Find the join request
    const joinRequest = await JoinRequest.findOne({
      _id: requestId,
      club: clubId,
      status: 'pending'
    }).populate('user');

    if (!joinRequest) {
      return res.status(404).json({ message: 'Join request not found or already processed' });
    }

    // Check if user is already a member (safety check)
    const existingMember = await Member.findOne({ club: clubId, user: joinRequest.user._id });
    if (existingMember) {
      return res.status(400).json({ message: 'User is already a member of this club' });
    }

    // Create new member
    const newMember = new Member({
      user: joinRequest.user._id,
      club: clubId,
      roles: ['member'],
    });

    await newMember.save();

    // Add member to club.members array
    club.members.push(newMember._id);
    
    // Remove join request from club.joinRequests array
    club.joinRequests = club.joinRequests.filter(
      reqId => reqId.toString() !== requestId
    );
    
    await club.save();

    // Delete the join request
    await JoinRequest.findByIdAndDelete(requestId);

    // Create notifications for approval and new member
    try {
      // Get the admin user who approved the request
      const adminUser = await User.findById(userId);
      
      // Notify the requester that their request was approved
      await createRequestApprovedNotification(joinRequest.user._id, club, adminUser);
      
      // Notify existing members about the new member (if there are other members)
      if (club.members.length > 1) {
        await createNewMemberNotification(club.members, newMember, club);
      }
    } catch (notificationError) {
      console.error('Failed to create approval/new member notifications:', notificationError);
      // Don't fail the request if notification fails
    }

    return res.status(200).json({
      message: 'Join request approved successfully',
      membership: newMember,
    });
  } catch (error) {
    console.error('Error approving join request:', error);
    return res.status(500).json({
      message: 'Server error',
      error: error?.message || error,
    });
  }
}

/**
 * POST /api/club/:clubId/join-requests/:requestId/reject - Reject join request
 */
async function rejectJoinRequest(req, res) {
  try {
    const { clubId, requestId } = req.params;
    const userId = req.user._id;

    // Validate IDs format
    if (!clubId.match(/^[0-9a-fA-F]{24}$/) || !requestId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: 'Invalid ID format' });
    }

    // Verify club exists
    const club = await Club.findById(clubId);
    if (!club) {
      return res.status(404).json({ message: 'Club not found' });
    }

    // Verify user is admin of this club
    const adminCheck = await verifyClubAdmin(userId, clubId);
    if (!adminCheck.isAdmin) {
      return res.status(403).json({ message: adminCheck.error });
    }

    // Find and validate the join request
    const joinRequest = await JoinRequest.findOne({
      _id: requestId,
      club: clubId,
      status: 'pending'
    }).populate('user');

    if (!joinRequest) {
      return res.status(404).json({ message: 'Join request not found or already processed' });
    }

    // Remove join request from club.joinRequests array
    club.joinRequests = club.joinRequests.filter(
      reqId => reqId.toString() !== requestId
    );
    await club.save();

    // Create notification for rejection
    try {
      // Get the admin user who rejected the request
      const adminUser = await User.findById(userId);
      
      // Notify the requester that their request was rejected
      await createRequestRejectedNotification(joinRequest.user._id, club, adminUser);
    } catch (notificationError) {
      console.error('Failed to create rejection notification:', notificationError);
      // Don't fail the request if notification fails
    }

    // Delete the join request
    await JoinRequest.findByIdAndDelete(requestId);

    return res.status(200).json({
      message: 'Join request rejected successfully',
    });
  } catch (error) {
    console.error('Error rejecting join request:', error);
    return res.status(500).json({
      message: 'Server error',
      error: error?.message || error,
    });
  }
}

/**
 * DELETE /api/club/:clubId/members/:memberId - Remove member from club (admin only)
 */
async function removeMember(req, res) {
  try {
    const { clubId, memberId } = req.params;
    const userId = req.user._id;

    // Validate IDs format
    if (!clubId.match(/^[0-9a-fA-F]{24}$/) || !memberId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: 'Invalid ID format' });
    }

    // Verify club exists
    const club = await Club.findById(clubId);
    if (!club) {
      return res.status(404).json({ message: 'Club not found' });
    }

    // Verify user is admin of this club
    const adminCheck = await verifyClubAdmin(userId, clubId);
    if (!adminCheck.isAdmin) {
      return res.status(403).json({ message: adminCheck.error });
    }

    // Find the member to remove
    const memberToRemove = await Member.findOne({
      _id: memberId,
      club: clubId
    });

    if (!memberToRemove) {
      return res.status(404).json({ message: 'Member not found in this club' });
    }

    // Prevent admin from removing themselves if they're the only admin
    if (memberToRemove.roles.includes('admin')) {
      const adminCount = await Member.countDocuments({
        club: clubId,
        roles: 'admin'
      });
      
      if (adminCount <= 1) {
        return res.status(400).json({ 
          message: 'Cannot remove the only admin. Assign another admin first.' 
        });
      }
    }

    // Remove member from club.members array
    club.members = club.members.filter(
      memId => memId.toString() !== memberId
    );
    await club.save();

    // Delete the member record
    await Member.findByIdAndDelete(memberId);

    return res.status(200).json({
      message: 'Member removed successfully',
    });
  } catch (error) {
    console.error('Error removing member:', error);
    return res.status(500).json({
      message: 'Server error',
      error: error?.message || error,
    });
  }
}
