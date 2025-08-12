import express from 'express';
import multer from 'multer';
import { addMember, createClub, getAllClubs, getClubById, joinClub, uploadClubLogo } from '../controllers/clubController.js';
import authMiddleware from '../middlewares/authMiddleware.js';

const router = express.Router();

// Configure multer to keep files in memory and limit size to 5MB
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.post('/addMember', authMiddleware, addMember);
router.post('/create', authMiddleware, createClub);
router.post('/:clubId/join', authMiddleware, joinClub);
router.post('/:clubId/logo', authMiddleware, upload.single('logo'), uploadClubLogo);

router.get('/', getAllClubs);
router.get('/:id', authMiddleware, getClubById);

export default router;
