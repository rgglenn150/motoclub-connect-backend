import express from 'express';
import multer from 'multer';
import {
  getPaymentsByCollection,
  createPayment,
  updatePaymentStatus,
  deletePayment,
  extractReceiptData,
  checkStatement,
  bulkVerifyPayments,
} from '../controllers/paymentController.js';
import authMiddleware, { optionalAuthMiddleware } from '../middlewares/authMiddleware.js';
import { STATEMENT_ERRORS } from '../utils/gcashStatement.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// GCash statements are read in memory and never stored (spec 004 FR-003, FR-013).
const statementUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
}).single('statement');

function receiveStatement(req, res, next) {
  statementUpload(req, res, (err) => {
    if (!err) return next();
    const code = err.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'NOT_PDF';
    const { status, message } = STATEMENT_ERRORS[code];
    return res.status(status).json({ code, message });
  });
}

router.get('/collection/:collectionId', optionalAuthMiddleware, getPaymentsByCollection);
router.post('/create', optionalAuthMiddleware, upload.single('receipt'), createPayment);
router.patch('/:paymentId/status', authMiddleware, updatePaymentStatus);
router.delete('/:paymentId', authMiddleware, deletePayment);
router.post('/collection/:collectionId/statement-check', authMiddleware, receiveStatement, checkStatement);
router.post('/collection/:collectionId/bulk-verify', authMiddleware, bulkVerifyPayments);
router.post('/extract-receipt', optionalAuthMiddleware, upload.single('receipt'), extractReceiptData);

export default router;
