import express from 'express';
import multer from 'multer';
import {
  createEvent,
  getAllEvents,
  getEventsByClub,
  getMyClubEvents,
  uploadEventImage,
} from '../controllers/eventController.js';
import authMiddleware from '../middlewares/authMiddleware.js';

const router = express.Router();

// Configure multer to keep files in memory and limit size to 5MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.post('/create', authMiddleware, createEvent);
router.post(
  '/:eventId/image',
  authMiddleware,
  upload.single('eventImage'),
  uploadEventImage
);

router.get('/', authMiddleware, getAllEvents);
router.get('/my-clubs', authMiddleware, getMyClubEvents);
router.get('/club/:clubId', authMiddleware, getEventsByClub);

export default router;
