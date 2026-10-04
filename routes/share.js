import express from 'express';
import {
  renderCollectionShare,
  renderCollectionCardImage,
} from '../controllers/shareController.js';

const router = express.Router();

router.get('/collection/:collectionId', renderCollectionShare);
router.get('/collection/:collectionId/card.png', renderCollectionCardImage);

export default router;
