import multer from 'multer';
import { sendReceiptError } from '../utils/receiptErrors.js';

const storage = multer.memoryStorage();

const upload = multer({ storage: storage });

/**
 * One optional photo in `field`: image-only, 10 MB, with coded size and type
 * errors (spec 008 FR-006). Payment receipts and remittance proofs (spec 009
 * research R5) share it.
 */
export function imageUpload(
  field,
  { malformedMessage = "Couldn't upload this photo. Please try again." } = {}
) {
  const receive = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
      if (file.mimetype?.startsWith('image/')) return cb(null, true);
      const err = new Error(`${field} is not an image`);
      err.code = 'UNSUPPORTED_FORMAT';
      return cb(err);
    },
  }).single(field);

  return (req, res, next) => {
    receive(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE')
        return sendReceiptError(res, 'FILE_TOO_LARGE');
      if (err.code === 'UNSUPPORTED_FORMAT')
        return sendReceiptError(res, 'UNSUPPORTED_FORMAT');
      // Extra files, a wrong field name or a broken body: not the photo's fault.
      console.warn(`Malformed ${field} upload:`, err.code, err.message);
      return res.status(400).json({ message: malformedMessage });
    });
  };
}

export default upload;
