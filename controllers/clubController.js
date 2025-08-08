import Club from '../models/ClubModel.js';
import Member from '../models/MemberModel.js';
import JoinRequest from '../models/JoinRequest.js';
import { validationResult } from 'express-validator';

export {
  createClub,
  addMember,
  getAllClubs,
  getClubById,
  joinClub
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

    // 5. Save the new club to the database
    await newClub.save();

    // 6. Respond with the newly created club data
    res.status(201).json(newClub);

  } catch (err) {
    // 7. Graceful error handling
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
