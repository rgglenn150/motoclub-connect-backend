const express = require('express');
const {
  createUser,
  getUser
} = require('../controllers/userController')

const router = express.Router();
const User = require('../models/UserModel')

router.get('/', getUser);
router.post('/', createUser);


router.patch('/', (req, res) => {
  res.json({
    message: 'update user '
  })
})

module.exports = router;