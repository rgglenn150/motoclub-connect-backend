import express from 'express';
import * as clubController from '../controllers/clubController.js';
import authMiddleware from '../middlewares/authMiddleware.js';

const router = express.Router();

router.post('/addMember', authMiddleware, clubController.addMember);
router.post('/create', authMiddleware, clubController.createClub);

router.get('/', clubController.getAllClubs);

export default router;
