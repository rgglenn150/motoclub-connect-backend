const User = require('../models/UserModel')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcrypt')

const createToken = (_id) => {
  return jwt.sign({
    _id
  }, process.env.SECRET, {
    expiresIn: '3d'
  })
}

const loginUser = async (req, res) => {
  const {
    email,
    password
  } = req.body;

  // Find the user with the given email
  const user = await User.findOne({
    email
  });
  console.log(req.body)

  if (!user) {
    // If the user doesn't exist, return an error response
    return res.status(400).json({
      message: 'Invalid email or password'
    });
  }

  // Compare the submitted password with the stored password hash
  const isPasswordValid = await bcrypt.compare(password, user.password);

  if (!isPasswordValid) {
    // If the password is incorrect, return an error response
    return res.status(400).json({
      message: 'Invalid email or password'
    });
  }

  // If the email and password are correct, store the user ID in the session
  req.session.userId = user._id;
  const token = createToken(user._id);
  // Return a success response
  res.status(200).json({
    message: 'Logged in successfully',
    token
  });
}

const logout = (req, res) => {

  // Clear the session data and redirect to the login page
  req.session.destroy(err => {

    if (err) {
      return res.status(500).send(err);
    }
    res.status(200).send({
      message: 'Logged out'
    });
  });
};

const signupUser = async (req, res) => {

  const {
    email,
    password,
    username,
    firstName,
    lastName
  } = req.body

  try {
    const user = await User.signup(email, password, username, firstName, lastName)

    const token = createToken(user._id);
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
  logout,
  signupUser
})