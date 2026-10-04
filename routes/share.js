import express from 'express';
import { shareRateLimit } from '../middlewares/rateLimit.js';
import {
  renderCollectionShare,
  renderCollectionCardImage,
} from '../controllers/shareController.js';

const router = express.Router();

// Public routes: limit per client (ADR-0001).
router.use(shareRateLimit);

router.get('/collection/:collectionId', renderCollectionShare);
router.get('/collection/:collectionId/card.png', renderCollectionCardImage);

export default router;
