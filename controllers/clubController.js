import Club from '../models/ClubModel.js';
import Member from '../models/MemberModel.js';
import JoinRequest from '../models/JoinRequest.js';
import { validationResult } from 'express-validator';
import cloudinary from '../utils/cloudinary.js';

export {
  createClub,
  addMember,
  getAllClubs,
  getClubById,
  joinClub,
  uploadClubLogo
};

async function createClub(req, res) {
  // 1. Validate incoming data
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    // If there are validation errors, return a 400 Bad Request response
    return res.status(400).json({
      errors: errors.array()
    });
  }

  // 2. Destructure sanitized data from the request body
  const {
    name,
    description,
    location,
    isPrivate
  } = req.body;

  try {
    // 3. Check if a club with the same name already exists
    const existingClub = await Club.findOne({
      clubName: name
    });
    if (existingClub) {
      return res.status(400).json({
        msg: 'A club with this name already exists.'
      });
    }

    // 4. Create a new Club instance without any initial members
    const newClub = new Club({
      clubName: name, // Use 'name' from body for 'clubName' field
      description,
      location,
      isPrivate,
      createdBy: req.user._id, // Correctly reference the user's _id
      // members property is omitted to allow the schema's default (empty array)
    });

    // 5. Create and add the creator as an admin member of this club
    const creatorMember = new Member({
      name: req.user.username || 'Club Admin',
      email: req.user.email || `${req.user._id}@users.local`,
      club: newClub._id,
      roles: ['member', 'admin'],
    });
    await creatorMember.save();
    newClub.members.push(creatorMember._id);

    // 6. Save the new club to the database
    await newClub.save();

    // 7. Respond with the newly created club data
    res.status(201).json(newClub);

  } catch (err) {
    // 8. Graceful error handling
    console.error(err.message);
    res.status(500).send('Server Error');
  }
}

async function addMember(req, res) {
  try {
    const {
      clubId,
      memberData
    } = req.body;

    // Find the club by ID
    const club = await Club.findById(clubId);
    if (!club) {
      return res.status(404).json({
        message: 'Club not found'
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
      member
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error adding member',
      error
    });
  }
}

async function getAllClubs(req, res) {
  const clubs = await Club.find();
  const clubsWithId = clubs.map(club => ({
    id: club._id,
    clubName: club.clubName,
    description: club.description,
    location: club.location,
    isPrivate: club.isPrivate,
    members: club.members,
    createdBy: club.createdBy,
    createdAt: club.createdAt,
  }));

  res.status(200).json({
    message: 'Get all clubs ',
    clubs: clubsWithId,
  });
}

async function getClubById(req, res) {
  try {
    const club = await Club.findById(req.params.id).populate('members', 'username');
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

    const club = await Club.findById(clubId);
    if (!club) {
      return res.status(404).json({ message: 'Club not found' });
    }

    const existingRequest = await JoinRequest.findOne({ user: userId, club: clubId });
    if (existingRequest) {
      return res.status(400).json({ message: 'You have already requested to join this club' });
    }

    const newJoinRequest = new JoinRequest({
      user: userId,
      club: clubId,
    });

    await newJoinRequest.save();

    club.joinRequests.push(newJoinRequest._id);
    await club.save();

    res.status(201).json({ message: 'Request to join club sent successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error joining club', error });
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
      return res.status(400).json({ message: 'Logo file is required (field name: logo)' });
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
    return res.status(500).json({ message: 'Error uploading club logo', error: error?.message || error });
  }
}
