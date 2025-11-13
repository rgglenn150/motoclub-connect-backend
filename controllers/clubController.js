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
import {
  buildNearQuery,
  calculateDistance,
  isValidCoordinates,
  kmToMeters
} from '../utils/geospatialUtils.js';

export {
  createClub,
  updateClub,
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
  promoteToAdmin,
  demoteToMember,
  checkClubNameAvailability,
  getNearbyClubs,
};

/**
 * GET /api/club/:clubId/members - Get all club members (members and admins can view)
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

    // Verify user is a member or admin of this club
    const userMembership = await Member.findOne({ user: userId, club: clubId });
    if (!userMembership) {
      return res.status(403).json({ message: 'You must be a member of this club to view the members list' });
    }

    // Get all members for the club, populating the user's details
    const members = await Member.find({ club: clubId }).populate('user', 'username email firstName lastName profilePhoto');

    // Format the response to match what the frontend expects
    const formattedMembers = members.map(member => ({
      _id: member._id,
      user: {
        _id: member.user._id,
        name: member.user.username || `${member.user.firstName} ${member.user.lastName}`.trim() || 'Unnamed User',
        email: member.user.email,
        username: member.user.username,
        firstName: member.user.firstName,
        lastName: member.user.lastName,
        profilePicture: member.user.profilePhoto,
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
  const { name, description, location, isPrivate, geolocation } = req.body;

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
    const clubData = {
      clubName: name, // Use 'name' from body for 'clubName' field
      description,
      location,
      isPrivate,
      createdBy: req.user._id, // Correctly reference the user's _id
      // members property is omitted to allow the schema's default (empty array)
    };

    // Add geolocation data if provided
    if (geolocation && geolocation.latitude && geolocation.longitude) {
      clubData.geolocation = {
        latitude: geolocation.latitude,
        longitude: geolocation.longitude,
        placeName: geolocation.placeName,
      };
    }

    const newClub = new Club(clubData);

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

/**
 * PUT /api/club/:clubId/update - Update club details (admin only)
 */
async function updateClub(req, res) {
  try {
    const { clubId } = req.params;
    const userId = req.user._id;

    // Handle both JSON and FormData requests
    let { clubName, name, description, location, isPrivate, geolocation } = req.body;

    // Map 'name' to 'clubName' for backwards compatibility
    if (name && !clubName) {
      clubName = name;
    }

    // Handle FormData string conversion for isPrivate
    if (typeof isPrivate === 'string') {
      isPrivate = isPrivate.toLowerCase() === 'true';
    }

    // Handle FormData JSON string conversion for geolocation
    if (typeof geolocation === 'string') {
      try {
        geolocation = JSON.parse(geolocation);
      } catch (parseError) {
        return res.status(400).json({
          message: 'Invalid geolocation format',
          error: 'Geolocation must be a valid JSON object'
        });
      }
    }

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

    // Basic input validation
    const validationErrors = [];

    if (clubName && (typeof clubName !== 'string' || clubName.trim().length < 2 || clubName.trim().length > 100)) {
      validationErrors.push({ field: 'clubName', message: 'Club name must be between 2 and 100 characters' });
    }

    if (description && (typeof description !== 'string' || description.trim().length < 10 || description.trim().length > 500)) {
      validationErrors.push({ field: 'description', message: 'Description must be between 10 and 500 characters' });
    }

    if (location && (typeof location !== 'string' || location.trim().length > 200)) {
      validationErrors.push({ field: 'location', message: 'Location must be less than 200 characters' });
    }

    if (isPrivate !== undefined && typeof isPrivate !== 'boolean') {
      validationErrors.push({ field: 'isPrivate', message: 'isPrivate must be a boolean value' });
    }

    if (geolocation && geolocation.latitude !== undefined && geolocation.longitude !== undefined) {
      if (typeof geolocation.latitude !== 'number' || geolocation.latitude < -90 || geolocation.latitude > 90) {
        validationErrors.push({ field: 'geolocation.latitude', message: 'Latitude must be a number between -90 and 90' });
      }
      if (typeof geolocation.longitude !== 'number' || geolocation.longitude < -180 || geolocation.longitude > 180) {
        validationErrors.push({ field: 'geolocation.longitude', message: 'Longitude must be a number between -180 and 180' });
      }
    }

    if (validationErrors.length > 0) {
      return res.status(400).json({
        message: 'Validation errors',
        errors: validationErrors,
      });
    }

    // Build update object with only provided fields
    const updateData = {};

    // Handle club name update with uniqueness check
    if (clubName && clubName !== club.clubName) {
      const existingClub = await Club.findOne({
        clubName: clubName,
        _id: { $ne: clubId }, // Exclude current club from search
      });
      if (existingClub) {
        return res.status(400).json({
          message: 'A club with this name already exists.',
        });
      }
      updateData.clubName = clubName;
    }

    // Handle other basic fields
    if (description !== undefined) {
      updateData.description = description;
    }
    if (location !== undefined) {
      updateData.location = location;
    }
    if (isPrivate !== undefined) {
      updateData.isPrivate = isPrivate;
    }

    // Handle geolocation data
    if (geolocation) {
      if (geolocation.latitude && geolocation.longitude) {
        updateData.geolocation = {
          latitude: geolocation.latitude,
          longitude: geolocation.longitude,
          placeName: geolocation.placeName || '',
        };
      } else if (geolocation === null || (geolocation.latitude === null && geolocation.longitude === null)) {
        // Allow clearing geolocation data
        updateData.$unset = { geolocation: 1 };
      }
    }

    // Handle logo upload if provided
    if (req.file) {
      try {
        // Convert buffer to data URI
        const base64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

        const uploadResult = await cloudinary.uploader.upload(base64, {
          folder: 'motoclub-connect/clubs',
          public_id: `club_${clubId}_logo`,
          overwrite: true,
          resource_type: 'image',
          transformation: [{ width: 512, height: 512, crop: 'limit' }],
        });

        updateData.logoUrl = uploadResult.secure_url;
        updateData.logoPublicId = uploadResult.public_id;
      } catch (uploadError) {
        console.error('Error uploading club logo:', uploadError);
        return res.status(500).json({
          message: 'Error uploading club logo',
          error: uploadError?.message || uploadError,
        });
      }
    }

    // Perform the update
    const updatedClub = await Club.findByIdAndUpdate(
      clubId,
      updateData,
      { new: true, runValidators: true }
    );

    if (!updatedClub) {
      return res.status(404).json({ message: 'Club not found after update' });
    }

    console.log('Club updated successfully:', updatedClub._id);

    // Return updated club data directly (matches frontend expectations)
    return res.status(200).json({
      _id: updatedClub._id,
      clubName: updatedClub.clubName,
      description: updatedClub.description,
      location: updatedClub.location || '',
      isPrivate: updatedClub.isPrivate,
      logoUrl: updatedClub.logoUrl,
      geolocation: updatedClub.geolocation,
      createdBy: updatedClub.createdBy,
      createdAt: updatedClub.createdAt,
      updatedAt: updatedClub.updatedAt,
    });
  } catch (error) {
    console.error('Error updating club:', error);
    return res.status(500).json({
      message: 'Server error updating club',
      error: error?.message || error,
    });
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
  try {
    const clubs = await Club.find();
    console.log('Found clubs:', clubs.length);

    const clubsWithId = clubs.map((club) => {
      console.log('Processing club:', club._id, 'Name:', club.clubName);
      return {
        _id: club._id,
        clubName: club.clubName,
        description: club.description,
        location: club.location || '',
        geolocation: club.geolocation,
        isPrivate: club.isPrivate,
        members: club.members,
        createdBy: club.createdBy,
        createdAt: club.createdAt,
        logoUrl: club.logoUrl,
      };
    });

    console.log('Returning clubs with IDs:', clubsWithId.map(c => ({ id: c._id, name: c.clubName })));

    res.status(200).json({
      message: 'Clubs retrieved successfully',
      clubs: clubsWithId,
    });
  } catch (error) {
    console.error('Error getting all clubs:', error);
    res.status(500).json({
      message: 'Server error retrieving clubs',
      error: error?.message || error,
    });
  }
}

async function getClubById(req, res) {
  try {
    const club = await Club.findById(req.params.id).populate(
      'members',
      'username'
    );
    if (!club) {
      return res.status(404).json({ message: 'Club not found' });
    }

    // Ensure consistent response format with _id field
    const clubData = {
      _id: club._id,
      clubName: club.clubName,
      description: club.description,
      location: club.location || '',
      geolocation: club.geolocation,
      isPrivate: club.isPrivate,
      members: club.members,
      createdBy: club.createdBy,
      createdAt: club.createdAt,
      updatedAt: club.updatedAt,
      logoUrl: club.logoUrl,
      joinRequests: club.joinRequests,
    };

    console.log('Returning club by ID:', clubData._id);
    res.status(200).json({
      message: 'Club retrieved successfully',
      club: clubData,
    });
  } catch (error) {
    console.error('Error getting club by ID:', error);
    res.status(500).json({
      message: 'Server error retrieving club',
      error: error?.message || error,
    });
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
    }).populate('user', 'username email firstName lastName profilePhoto');

    // Format response to match required structure
    const formattedRequests = joinRequests.map(request => ({
      _id: request._id,
      user: {
        _id: request.user._id,
        name: request.user.username || 
          (request.user.firstName && request.user.lastName ? 
            `${request.user.firstName} ${request.user.lastName}` : 
            'Unknown User'),
        email: request.user.email,
        username: request.user.username,
        firstName: request.user.firstName,
        lastName: request.user.lastName,
        profilePicture: request.user.profilePhoto,
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

/**
 * POST /api/club/:clubId/members/:memberId/promote - Promote member to admin (admin only)
 */
async function promoteToAdmin(req, res) {
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

    // Find the member to promote
    const memberToPromote = await Member.findOne({
      _id: memberId,
      club: clubId
    }).populate('user', 'username email firstName lastName profilePhoto');

    if (!memberToPromote) {
      return res.status(404).json({ message: 'Member not found in this club' });
    }

    // Check if member is already an admin
    if (memberToPromote.roles.includes('admin')) {
      return res.status(400).json({ message: 'Member is already an admin' });
    }

    // Promote member to admin by adding 'admin' role
    memberToPromote.roles.push('admin');
    await memberToPromote.save();

    // Format the response to match what the frontend expects
    const formattedMember = {
      _id: memberToPromote._id,
      user: {
        _id: memberToPromote.user._id,
        name: memberToPromote.user.username || `${memberToPromote.user.firstName} ${memberToPromote.user.lastName}`.trim() || 'Unnamed User',
        email: memberToPromote.user.email,
        username: memberToPromote.user.username,
        firstName: memberToPromote.user.firstName,
        lastName: memberToPromote.user.lastName,
        profilePicture: memberToPromote.user.profilePhoto,
      },
      club: memberToPromote.club,
      role: 'admin',
      joinedAt: memberToPromote.joinedDate,
    };

    return res.status(200).json({
      message: 'Member promoted to admin successfully',
      member: formattedMember,
    });
  } catch (error) {
    console.error('Error promoting member:', error);
    return res.status(500).json({
      message: 'Server error',
      error: error?.message || error,
    });
  }
}

/**
 * POST /api/club/:clubId/members/:memberId/demote - Demote admin to member (admin only)
 */
async function demoteToMember(req, res) {
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

    // Find the member to demote
    const memberToDemote = await Member.findOne({
      _id: memberId,
      club: clubId
    }).populate('user', 'username email firstName lastName profilePhoto');

    if (!memberToDemote) {
      return res.status(404).json({ message: 'Member not found in this club' });
    }

    // Check if member is actually an admin
    if (!memberToDemote.roles.includes('admin')) {
      return res.status(400).json({ message: 'Member is not an admin' });
    }

    // Prevent admin from demoting themselves (admin lockout prevention)
    if (memberToDemote.user._id.toString() === userId.toString()) {
      return res.status(400).json({ message: 'You cannot demote yourself' });
    }

    // Check if this is the only admin
    const adminCount = await Member.countDocuments({
      club: clubId,
      roles: 'admin'
    });

    if (adminCount <= 1) {
      return res.status(400).json({ 
        message: 'Cannot demote the only admin. There must be at least one admin in the club.' 
      });
    }

    // Demote admin to member by removing 'admin' role
    memberToDemote.roles = memberToDemote.roles.filter(role => role !== 'admin');
    await memberToDemote.save();

    // Format the response to match what the frontend expects
    const formattedMember = {
      _id: memberToDemote._id,
      user: {
        _id: memberToDemote.user._id,
        name: memberToDemote.user.username || `${memberToDemote.user.firstName} ${memberToDemote.user.lastName}`.trim() || 'Unnamed User',
        email: memberToDemote.user.email,
        username: memberToDemote.user.username,
        firstName: memberToDemote.user.firstName,
        lastName: memberToDemote.user.lastName,
        profilePicture: memberToDemote.user.profilePhoto,
      },
      club: memberToDemote.club,
      role: 'member',
      joinedAt: memberToDemote.joinedDate,
    };

    return res.status(200).json({
      message: 'Admin demoted to member successfully',
      member: formattedMember,
    });
  } catch (error) {
    console.error('Error demoting member:', error);
    return res.status(500).json({
      message: 'Server error',
      error: error?.message || error,
    });
  }
}

/**
 * GET /api/club/check-name/:name - Check if a club name is available
 */
async function checkClubNameAvailability(req, res) {
  try {
    const { name } = req.params;
    const { excludeId } = req.query;

    // Basic validation
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({
        message: 'Club name must be at least 2 characters long',
        available: false,
      });
    }

    // Build query to check for existing club with the same name
    const query = { clubName: name.trim() };

    // If excludeId is provided, exclude that club from the search (for editing)
    if (excludeId && excludeId.match(/^[0-9a-fA-F]{24}$/)) {
      query._id = { $ne: excludeId };
    }

    // Check if club with the same name already exists
    const existingClub = await Club.findOne(query);

    // Return availability status
    return res.status(200).json({
      available: !existingClub,
      message: existingClub ? 'A club with this name already exists' : 'Club name is available',
    });
  } catch (error) {
    console.error('Error checking club name availability:', error);
    return res.status(500).json({
      message: 'Server error checking club name availability',
      error: error?.message || error,
      available: false,
    });
  }
}

/**
 * GET /api/club/nearby - Get nearby clubs based on user's coordinates using MongoDB geospatial queries
 */
async function getNearbyClubs(req, res) {
  try {
    // Extract and validate query parameters
    const { latitude, longitude, radius = 50, limit = 20, includePrivate = 'false' } = req.query;

    console.log('Getting nearby clubs with params:', { latitude, longitude, radius, limit, includePrivate });

    // Comprehensive input validation
    const validationErrors = [];

    // Validate required coordinates
    if (!latitude || !longitude) {
      validationErrors.push({ field: 'coordinates', message: 'Both latitude and longitude are required' });
    }

    // Validate coordinate values
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lng)) {
      validationErrors.push({ field: 'coordinates', message: 'Latitude and longitude must be valid numbers' });
    } else if (!isValidCoordinates(lat, lng)) {
      validationErrors.push({ field: 'coordinates', message: 'Invalid coordinate ranges' });
    }

    // Validate radius
    const searchRadius = parseFloat(radius);
    if (isNaN(searchRadius) || searchRadius <= 0 || searchRadius > 500) {
      validationErrors.push({ field: 'radius', message: 'Radius must be a number between 0 and 500 km' });
    }

    // Validate limit
    const resultLimit = parseInt(limit);
    if (isNaN(resultLimit) || resultLimit <= 0 || resultLimit > 100) {
      validationErrors.push({ field: 'limit', message: 'Limit must be a number between 1 and 100' });
    }

    // Return validation errors if any
    if (validationErrors.length > 0) {
      return res.status(400).json({
        message: 'Validation errors in query parameters',
        errors: validationErrors,
      });
    }

    // Parse includePrivate flag
    const includePrivateClubs = includePrivate === 'true';

    // Convert radius from kilometers to meters for MongoDB geospatial query
    const maxDistanceMeters = kmToMeters(searchRadius);

    // Build the geospatial query using MongoDB's native $near operator
    const geoQuery = buildNearQuery(lat, lng, maxDistanceMeters);

    // Build the match criteria
    const matchCriteria = {
      geoPoint: geoQuery,
      // Include private club filter
      ...(includePrivateClubs ? {} : { isPrivate: { $ne: true } })
    };

    console.log('Geospatial query:', JSON.stringify(matchCriteria, null, 2));

    try {
      // Primary query: Use MongoDB's native geospatial capabilities
      const clubs = await Club.find(matchCriteria)
        .limit(resultLimit)
        .select('_id clubName description location geolocation geoPoint isPrivate logoUrl members createdAt')
        .lean()
        .maxTimeMS(10000);

      console.log(`Found ${clubs.length} clubs using native geospatial query`);

      // If no clubs found with native query, try fallback method
      if (clubs.length === 0) {
        console.log('No clubs found with native query, trying fallback method...');
        throw new Error('No results from native query, fallback required');
      }

      // Calculate accurate distances and add member count
      const clubsWithDistance = clubs.map(club => {
        let distance = 0;
        let memberCount = 0;

        // Calculate distance using Haversine formula for accuracy
        if (club.geoPoint && club.geoPoint.coordinates) {
          const [clubLng, clubLat] = club.geoPoint.coordinates;
          distance = calculateDistance(lat, lng, clubLat, clubLng);
        } else if (club.geolocation) {
          // Fallback to legacy geolocation format
          distance = calculateDistance(lat, lng, club.geolocation.latitude, club.geolocation.longitude);
        }

        // Calculate member count
        if (Array.isArray(club.members)) {
          memberCount = club.members.length;
        }

        return {
          _id: club._id,
          clubName: club.clubName,
          description: club.description,
          location: club.location || '',
          geolocation: club.geolocation,
          isPrivate: club.isPrivate || false,
          logoUrl: club.logoUrl || null,
          memberCount: memberCount,
          distance: Math.round(distance * 100) / 100, // Round to 2 decimal places
          createdAt: club.createdAt,
        };
      });

      // Sort by distance (closest first) since $near should already do this, but ensure it
      clubsWithDistance.sort((a, b) => a.distance - b.distance);

      // Prepare response
      const response = {
        message: 'Nearby clubs retrieved successfully',
        clubs: clubsWithDistance,
        total: clubsWithDistance.length,
        searchRadius: searchRadius,
        userLocation: {
          latitude: lat,
          longitude: lng
        },
        queryMethod: 'native_geospatial'
      };

      return res.status(200).json(response);

    } catch (geoError) {
      console.warn('Native geospatial query failed, falling back to legacy method:', geoError);

      // Fallback: Use legacy geolocation field with aggregation pipeline
      const fallbackPipeline = [
        // Match clubs with legacy geolocation data and privacy settings
        {
          $match: {
            geolocation: { $exists: true, $ne: null },
            'geolocation.latitude': { $exists: true, $ne: null },
            'geolocation.longitude': { $exists: true, $ne: null },
            ...(includePrivateClubs ? {} : { isPrivate: { $ne: true } })
          }
        },
        // Add accurate distance calculation using Haversine formula
        {
          $addFields: {
            distance: {
              $let: {
                vars: {
                  dLat: { $degreesToRadians: { $subtract: ['$geolocation.latitude', lat] } },
                  dLng: { $degreesToRadians: { $subtract: ['$geolocation.longitude', lng] } },
                  lat1: { $degreesToRadians: lat },
                  lat2: { $degreesToRadians: '$geolocation.latitude' }
                },
                in: {
                  $multiply: [
                    6371, // Earth's radius in kilometers
                    {
                      $multiply: [
                        2,
                        {
                          $asin: {
                            $sqrt: {
                              $add: [
                                { $pow: [{ $sin: { $divide: ['$$dLat', 2] } }, 2] },
                                {
                                  $multiply: [
                                    { $cos: '$$lat1' },
                                    { $cos: '$$lat2' },
                                    { $pow: [{ $sin: { $divide: ['$$dLng', 2] } }, 2] }
                                  ]
                                }
                              ]
                            }
                          }
                        }
                      ]
                    }
                  ]
                }
              }
            },
            memberCount: { $size: '$members' }
          }
        },
        // Filter by distance (within search radius)
        {
          $match: {
            distance: { $lte: searchRadius }
          }
        },
        // Sort by distance (closest first)
        {
          $sort: { distance: 1 }
        },
        // Limit results
        { $limit: resultLimit },
        // Project only required fields
        {
          $project: {
            _id: 1,
            clubName: 1,
            description: 1,
            location: 1,
            geolocation: 1,
            isPrivate: 1,
            logoUrl: 1,
            memberCount: 1,
            distance: 1,
            createdAt: 1,
          }
        }
      ];

      const fallbackClubs = await Club.aggregate(fallbackPipeline, { maxTimeMS: 10000 });

      console.log(`Fallback query found ${fallbackClubs.length} nearby clubs within ${searchRadius}km`);

      const response = {
        message: 'Nearby clubs retrieved successfully',
        clubs: fallbackClubs.map(club => ({
          _id: club._id,
          clubName: club.clubName,
          description: club.description,
          location: club.location || '',
          geolocation: club.geolocation,
          isPrivate: club.isPrivate || false,
          logoUrl: club.logoUrl || null,
          memberCount: club.memberCount || 0,
          distance: Math.round(club.distance * 100) / 100,
          createdAt: club.createdAt,
        })),
        total: fallbackClubs.length,
        searchRadius: searchRadius,
        userLocation: {
          latitude: lat,
          longitude: lng
        },
        queryMethod: 'fallback_aggregation'
      };

      return res.status(200).json(response);
    }

  } catch (error) {
    console.error('Error getting nearby clubs:', error);

    // Handle specific MongoDB errors
    if (error.name === 'MongooseError' || error.name === 'MongoError') {
      return res.status(500).json({
        message: 'Database error while searching for nearby clubs',
        error: 'Please try again later',
      });
    }

    // Handle timeout errors
    if (error.code === 50 || error.message?.includes('timeout')) {
      return res.status(504).json({
        message: 'Search timeout - please try again with a smaller search radius',
        error: 'Query timeout',
      });
    }

    // General error response
    return res.status(500).json({
      message: 'Server error while searching for nearby clubs',
      error: error?.message || 'Internal server error',
    });
  }
}
