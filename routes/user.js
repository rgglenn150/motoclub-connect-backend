const express = require('express');
const {
  getUser
} = require('../controllers/userController')

const router = express.Router();
const User = require('../models/UserModel')


router.get('/', getUser);



module.exports = router;