import express from 'express';
import {
  getRemittancesByCollection,
  createRemittance,
  voidRemittance,
} from '../controllers/remittanceController.js';
import authMiddleware, {
  optionalAuthMiddleware,
} from '../middlewares/authMiddleware.js';
import { imageUpload } from '../middlewares/upload.js';

const router = express.Router();

// Optional-auth on purpose: signed-out visitors to a public collection see its
// summary and Public records (spec 009 contracts, constitution VI).
router.get(
  '/collection/:collectionId',
  optionalAuthMiddleware,
  getRemittancesByCollection
);
router.post('/create', authMiddleware, imageUpload('proof'), createRemittance);
router.patch('/:remittanceId/void', authMiddleware, voidRemittance);

export default router;
