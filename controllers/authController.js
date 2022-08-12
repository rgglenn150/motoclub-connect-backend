const User = require('../models/UserModel')
const jwt = require('jsonwebtoken')

const createToken = (_id) => {
  return jwt.sign({
    _id
  }, process.env.SECRET, {
    expiresIn: '3d'
  })
}

const loginUser = async (req, res) => {
  res.send({
    message: 'login user'
  })
}

const signupUser = async (req, res) => {

  const {
    email,
    password
  } = req.body

  try {
    const user = await User.signup(email, password)

    const token = createToken(user._id)
    res.status(200).send({
      email,
      token
    })
  } catch (error) {
    console.log(error)
    res.status(400).send({
      message: error.message
    })
  }


}



module.exports = ({
  loginUser,
  signupUser
})