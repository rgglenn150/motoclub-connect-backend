const express = require('express');
const clubController = require('../controllers/clubController');
const router = express.Router();

router.post('/addMember', clubController.addMember);
router.post('/create', clubController.createClub);

router.get('/', clubController.getAllClubs);

module.exports = router;