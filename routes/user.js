const express = require('express');

const router = express.Router();

const User = require('../models/UserModel')

router.get('/', (req, res) => {
  res.json({
    message: 'Get all user '
  })
});

//get single user 
router.get('/:id', (req, res) => {
  res.json({
    message: 'get single user ',
    data: req.params
  })
})


router.post('/', async (req, res) => {
  const {
    firstName,
    lastName,
    age
  } = req.body
  try {

    const user = await User.create({
      firstName,
      lastName,
      age
    });
    res.status(200).send(user)

  } catch (error) {
    console.log(error);
    res.status(400).send({
      error: error.message
    })
  }


  res.json({
    message: 'create new member',
  })
})


router.patch('/', (req, res) => {
  res.json({
    message: 'update user '
  })
})

module.exports = router;