const express = require('express');
const {
  createUser,
  getUser
} = require('../controllers/userController')

const router = express.Router();
const User = require('../models/UserModel')


router.get('/', getUser);
/* router.post('/', createUser); */



module.exports = router;