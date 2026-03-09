import express from 'express';
import multer from 'multer';
import {
  getPaymentsByCollection,
  createPayment,
  updatePaymentStatus,
  deletePayment,
  extractReceiptData,
} from '../controllers/paymentController.js';
import authMiddleware from '../middlewares/authMiddleware.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.get('/collection/:collectionId', authMiddleware, getPaymentsByCollection);
router.post('/create', authMiddleware, upload.single('receipt'), createPayment);
router.patch('/:paymentId/status', authMiddleware, updatePaymentStatus);
router.delete('/:paymentId', authMiddleware, deletePayment);
router.post('/extract-receipt', authMiddleware, upload.single('receipt'), extractReceiptData);

export default router;
