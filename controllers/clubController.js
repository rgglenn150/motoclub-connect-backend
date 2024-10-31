const Club = require('../models/ClubModel');
const Member = require('../models/MemberModel');

exports.createClub = async (req, res) => {
  const club = await Club.create(req.body);
  res.status(200).json({
    message: 'Club created successfully',
    club
  });
}



exports.addMember = async (req, res) => {
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
};

exports.getAllClubs = async (req, res) => {
  const clubs = await Club.find();
  res.status(200).json({
    message: 'Get all clubs ',
    clubs
  })
}