import express from 'express';
import multer from 'multer';
import authMiddleware from '../middlewares/authMiddleware.js';
import {
  createOfficialMember,
  getOfficialMembers,
  getOfficialMemberById,
  updateOfficialMember,
  deleteOfficialMember,
  importOfficialMembersFromCSV,
  exportOfficialMembersToCSV,
  searchOfficialMembers,
  filterOfficialMembers,
  createClaimRequest,
  getPendingClaimRequests,
  approveClaimRequest,
  rejectClaimRequest,
  getMyClaimRequests,
  generateIDCard,
  updateOfficialMembersVisibility,
  getOfficialMembersVisibility
} from '../controllers/officialMemberController.js';

const router = express.Router();

// Configure multer for CSV file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    // Accept common CSV MIME types (browsers are inconsistent)
    const allowedMimeTypes = [
      'text/csv',
      'application/vnd.ms-excel',
      'application/csv',
      'text/plain',
      'text/x-csv',
      'application/x-csv',
    ];

    // Also check file extension as a fallback
    const isCSVExtension = file.originalname?.toLowerCase().endsWith('.csv');

    if (allowedMimeTypes.includes(file.mimetype) || isCSVExtension) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  }
});

// CRUD OPERATIONS
router.post('/:clubId/members', authMiddleware, createOfficialMember);
router.get('/:clubId/members', authMiddleware, getOfficialMembers);
router.get('/:clubId/members/:memberId', authMiddleware, getOfficialMemberById);
router.put('/:clubId/members/:memberId', authMiddleware, updateOfficialMember);
router.delete('/:clubId/members/:memberId', authMiddleware, deleteOfficialMember);

// CSV IMPORT/EXPORT
router.post('/:clubId/import', authMiddleware, upload.single('csv'), importOfficialMembersFromCSV);
router.get('/:clubId/export', authMiddleware, exportOfficialMembersToCSV);

// SEARCH AND FILTER
router.get('/:clubId/search', authMiddleware, searchOfficialMembers);
router.get('/:clubId/filter', authMiddleware, filterOfficialMembers);

// CLAIM REQUESTS
router.post('/:clubId/members/:memberId/claim', authMiddleware, createClaimRequest);
router.get('/:clubId/claims/pending', authMiddleware, getPendingClaimRequests);
router.post('/:clubId/claims/:claimId/approve', authMiddleware, approveClaimRequest);
router.post('/:clubId/claims/:claimId/reject', authMiddleware, rejectClaimRequest);
router.get('/:clubId/claims/my-requests', authMiddleware, getMyClaimRequests);

// ID CARD GENERATION
router.get('/:clubId/members/:memberId/id-card', authMiddleware, generateIDCard);

// VISIBILITY MANAGEMENT
router.put('/:clubId/visibility', authMiddleware, updateOfficialMembersVisibility);
router.get('/:clubId/visibility', authMiddleware, getOfficialMembersVisibility);

export default router;
