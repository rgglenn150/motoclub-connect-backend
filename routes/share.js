import express from 'express';
import { renderCollectionShare } from '../controllers/shareController.js';

const router = express.Router();

router.get('/collection/:collectionId', renderCollectionShare);

export default router;
