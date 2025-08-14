import User from '../models/UserModel.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

const createToken = (_id) =>
  jwt.sign({
      _id
    },
    process.env.JWT_SECRET, // <-- Correct variable
    {
      expiresIn: '3d'
    }
  );


export const loginUser = async (req, res) => {
  const {
    email,
    password
  } = req.body;

  const user = await User.findOne({
    email,
  });
  console.log('rgdb user : ', user);

  if (!user) {
    return res.status(400).json({
      message: 'Invalid email or password',
    });
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);

  if (!isPasswordValid) {
    return res.status(400).json({
      message: 'Invalid email or password',
    });
  }

  req.session.userId = user._id;
  const token = createToken(user._id);
  const userObject = user.toObject();
  delete userObject.password;

  res.status(200).json({
    message: 'Logged in successfully',
    token,
    user: userObject,
  });
};

export const logout = (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).send(err);
    }
    res.status(200).send({
      message: 'Logged out',
    });
  });
};

export const signupUser = async (req, res) => {
  const {
    email,
    password,
    username,
    firstName,
    lastName
  } = req.body;

  try {
    const user = await User.signup(
      email,
      password,
      username,
      firstName,
      lastName
    );
    const token = createToken(user._id);
    res.status(200).send({
      email,
      token,
    });
  } catch (error) {
    console.log(error);
    res.status(400).send({
      message: error.message,
    });
  }
};