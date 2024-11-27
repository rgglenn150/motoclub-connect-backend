import express from 'express';
import {
  loginUser,
  signupUser,
  logout,
} from '../controllers/authController.js';

const router = express.Router();

// signup new user
router.post('/signup', signupUser);
router.post('/login', loginUser);
router.post('/logout', logout);

export default router;
