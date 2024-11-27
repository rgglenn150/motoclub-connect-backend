import Club from '../models/ClubModel.js';
import Member from '../models/MemberModel.js';

export { createClub, addMember, getAllClubs };

async function createClub(req, res) {
  const club = await Club.create(req.body);
  res.status(200).json({
    message: 'Club created successfully',
    club,
  });
}

async function addMember(req, res) {
  try {
    const { clubId, memberData } = req.body;

    // Find the club by ID
    const club = await Club.findById(clubId);
    if (!club) {
      return res.status(404).json({ message: 'Club not found' });
    }

    // Create a new member
    const member = new Member(memberData);
    await member.save();

    // Add the member to the club
    club.members.push(member._id);
    await club.save();

    res.status(201).json({ message: 'Member added successfully', member });
  } catch (error) {
    res.status(500).json({ message: 'Error adding member', error });
  }
}

async function getAllClubs(req, res) {
  const clubs = await Club.find();
  console.log('rgdb clubs : ', clubs);

  res.status(200).json({
    message: 'Get all clubs ',
    clubs,
  });
}
