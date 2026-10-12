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
import authMiddleware, {
  optionalAuthMiddleware,
} from '../middlewares/authMiddleware.js';
import { STATEMENT_ERRORS } from '../utils/gcashStatement.js';
import { sendReceiptError } from '../utils/receiptErrors.js';

const router = express.Router();

// Receipts must be images; size and type errors are coded (spec 008 FR-006).
const receiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype?.startsWith('image/')) return cb(null, true);
    const err = new Error('Receipt is not an image');
    err.code = 'UNSUPPORTED_FORMAT';
    return cb(err);
  },
}).single('receipt');

function receiveReceipt(req, res, next) {
  receiptUpload(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE')
      return sendReceiptError(res, 'FILE_TOO_LARGE');
    if (err.code === 'UNSUPPORTED_FORMAT')
      return sendReceiptError(res, 'UNSUPPORTED_FORMAT');
    // Extra files, a wrong field name or a broken body: not the photo's fault.
    return res.status(400).json({
      message: "Couldn't upload this receipt. Please try again.",
    });
  });
}

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

router.get(
  '/collection/:collectionId',
  optionalAuthMiddleware,
  getPaymentsByCollection
);
router.post('/create', optionalAuthMiddleware, receiveReceipt, createPayment);
router.patch('/:paymentId/status', authMiddleware, updatePaymentStatus);
router.delete('/:paymentId', authMiddleware, deletePayment);
router.post(
  '/collection/:collectionId/statement-check',
  authMiddleware,
  receiveStatement,
  checkStatement
);
router.post(
  '/collection/:collectionId/bulk-verify',
  authMiddleware,
  bulkVerifyPayments
);
router.post(
  '/extract-receipt',
  optionalAuthMiddleware,
  receiveReceipt,
  extractReceiptData
);

export default router;
