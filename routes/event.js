import express from 'express';
import multer from 'multer';
import {
  createEvent,
  getAllEvents,
  getEventById,
  getEventsByClub,
  getMyClubEvents,
  getGlobalEvents,
  joinEvent,
  leaveEvent,
  deleteEvent,
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
// IMPORTANT: /global must be declared before /:eventId so Express does not
// match it as an :eventId param.
router.get('/global', authMiddleware, getGlobalEvents);
router.get('/club/:clubId', authMiddleware, getEventsByClub);
router.get('/:eventId', authMiddleware, getEventById);

router.post('/:eventId/join', authMiddleware, joinEvent);
router.post('/:eventId/leave', authMiddleware, leaveEvent);
router.delete('/:eventId', authMiddleware, deleteEvent);

export default router;
