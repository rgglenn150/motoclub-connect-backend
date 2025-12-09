import express from 'express';
import {
  getUser,
  getCurrentUser,
  updateProfile,
  updateUsername,
  updateEmail,
  checkUsernameAvailability,
  checkEmailAvailability,
  uploadProfilePhoto,
  updateUser, // Legacy - deprecated
} from '../controllers/userController.js';
import User from '../models/UserModel.js';
import upload from '../middlewares/upload.js';
import authMiddleware from '../middlewares/authMiddleware.js';

const router = express.Router();

// Get all users (admin functionality)
router.get('/', authMiddleware, getUser);

// Get current authenticated user's profile
router.get('/me', authMiddleware, getCurrentUser);

// Update non-sensitive profile fields
router.put('/me/profile', authMiddleware, updateProfile);

// Update username with password confirmation
router.put('/me/username', authMiddleware, updateUsername);

// Update email with password confirmation
router.put('/me/email', authMiddleware, updateEmail);

// Check username availability
router.get('/check-username/:username', authMiddleware, checkUsernameAvailability);

// Check email availability
router.get('/check-email/:email', authMiddleware, checkEmailAvailability);

// Upload profile photo
router.post(
  '/profile-photo',
  authMiddleware,
  upload.single('profilePhoto'),
  uploadProfilePhoto
);

// DEPRECATED: Legacy update user endpoint - disabled for security
router.put('/:id', authMiddleware, updateUser);

export default router;
