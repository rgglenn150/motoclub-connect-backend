import express from 'express';
import { addMember, createClub, getAllClubs, getClubById } from '../controllers/clubController.js';
import authMiddleware from '../middlewares/authMiddleware.js';

const router = express.Router();

router.post('/addMember', authMiddleware, addMember);
router.post('/create', authMiddleware, createClub);

router.get('/', getAllClubs);
router.get('/:id', authMiddleware, getClubById);

export default router;
