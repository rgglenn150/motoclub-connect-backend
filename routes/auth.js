import express from 'express';
import {
  loginUser,
  signupUser,
  logout,
} from '../controllers/authController.js';
import {
  facebookLogin,
  facebookRegister,
} from '../controllers/facebookAuthController.js';

const router = express.Router();

// signup new user
router.post('/signup', signupUser);
router.post('/login', loginUser);
router.post('/logout', logout);

// Facebook authentication routes
router.post('/facebook', facebookLogin);
router.post('/facebook/register', facebookRegister);

export default router;
