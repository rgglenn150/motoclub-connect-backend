const express = require('express');
const clubController = require('../controllers/clubController');
const router = express.Router();

import authMiddleware from '../middlewares/authMiddleware.js';


router.post('/addMember',authMiddleware, clubController.addMember);
router.post('/create',authMiddleware, clubController.createClub);

router.get('/', clubController.getAllClubs);

module.exports = router;