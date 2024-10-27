const Club = require('../models/ClubModel');

exports.createClub = async (req, res) => {
  const club = await Club.create(req.body);
  res.status(200).json({
    message: 'Club created successfully',
    club
  });
}