import express from 'express';
import multer from 'multer';
import {
  addMember,
  createClub,
  updateClub,
  getAllClubs,
  getClubById,
  joinClub,
  uploadClubLogo,
  getMembershipStatus,
  getJoinRequests,
  approveJoinRequest,
  rejectJoinRequest,
  removeMember,
  getClubMembers,
  promoteToAdmin,
  demoteToMember,
  checkClubNameAvailability,
} from '../controllers/clubController.js';
import authMiddleware from '../middlewares/authMiddleware.js';

const router = express.Router();

// Configure multer to keep files in memory and limit size to 5MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.post('/addMember', authMiddleware, addMember);
router.post('/create', authMiddleware, createClub);
router.put('/:clubId/update', authMiddleware, upload.single('logo'), updateClub);
router.post('/:clubId/join', authMiddleware, joinClub);
router.post(
  '/:clubId/logo',
  authMiddleware,
  upload.single('logo'),
  uploadClubLogo
);

router.get('/', getAllClubs);
router.get('/:id', authMiddleware, getClubById);
router.get('/check-name/:name', checkClubNameAvailability);
router.get('/:clubId/membership-status', authMiddleware, getMembershipStatus);

// Join request management endpoints (admin only)
router.get('/:clubId/join-requests', authMiddleware, getJoinRequests);
router.post('/:clubId/join-requests/:requestId/approve', authMiddleware, approveJoinRequest);
router.post('/:clubId/join-requests/:requestId/reject', authMiddleware, rejectJoinRequest);

// Member management endpoints (admin only)
router.get('/:clubId/members', authMiddleware, getClubMembers);
router.delete('/:clubId/members/:memberId', authMiddleware, removeMember);
router.post('/:clubId/members/:memberId/promote', authMiddleware, promoteToAdmin);
router.post('/:clubId/members/:memberId/demote', authMiddleware, demoteToMember);

export default router;
