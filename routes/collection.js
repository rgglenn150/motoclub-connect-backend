import express from 'express';
import {
  getCollectionsByClub,
  createCollection,
  updateCollection,
  deleteCollection,
} from '../controllers/collectionController.js';
import authMiddleware from '../middlewares/authMiddleware.js';

const router = express.Router();

router.get('/club/:clubId', authMiddleware, getCollectionsByClub);
router.post('/create', authMiddleware, createCollection);
router.put('/:collectionId', authMiddleware, updateCollection);
router.delete('/:collectionId', authMiddleware, deleteCollection);

export default router;
