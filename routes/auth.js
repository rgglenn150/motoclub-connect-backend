const express = require('express');
const {
  loginUser,
  signupUser,
  logout
} = require('../controllers/authController')

const router = express.Router();

// signup new user
router.post('/signup', signupUser);
router.post('/login', loginUser);
router.post('/logout', logout)



module.exports = router;