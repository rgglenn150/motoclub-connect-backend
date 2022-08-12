const express = require('express');
const {
  loginUser,
  signupUser
} = require('../controllers/authController')

const router = express.Router();

// signup new user
router.post('/signup', signupUser);
router.post('/login', loginUser)



module.exports = router;