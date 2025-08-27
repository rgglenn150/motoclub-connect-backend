import express from 'express';
import {
  createEvent,
  getAllEvents,
  getEventsByClub,
} from '../controllers/eventController.js';
import authMiddleware from '../middlewares/authMiddleware.js';

const router = express.Router();

router.post('/create', authMiddleware, createEvent);
router.get('/', authMiddleware, getAllEvents);
router.get('/club/:clubId', authMiddleware, getEventsByClub);

export default router;
