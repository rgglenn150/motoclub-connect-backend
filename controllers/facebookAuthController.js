import User from '../models/UserModel.js';
import jwt from 'jsonwebtoken';
import axios from 'axios';

// Create JWT token (reusing pattern from authController.js)
const createToken = (_id) =>
  jwt.sign(
    {
      _id,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: '3d',
    }
  );

// Verify Facebook access token with Facebook Graph API
const verifyFacebookToken = async (accessToken) => {
  try {
    const response = await axios.get(
      `https://graph.facebook.com/me?access_token=${accessToken}&fields=id,email,first_name,last_name,picture.type(large)`
    );
    return response.data;
  } catch (error) {
    console.error(
      'Facebook token verification failed:',
      error.response?.data || error.message
    );
    throw new Error('Invalid Facebook access token');
  }
};

// Facebook login endpoint
export const facebookLogin = async (req, res) => {
  const { accessToken } = req.body;

  if (!accessToken) {
    return res.status(400).json({
      message: 'Facebook access token is required',
    });
  }

  try {
    // Verify token with Facebook
    const facebookUser = await verifyFacebookToken(accessToken);

    const {
      id: facebookId,
      email,
      first_name,
      last_name,
      picture,
    } = facebookUser;

    if (!email) {
      return res.status(400).json({
        message: 'Email permission required from Facebook',
      });
    }

    // Check if user exists with Facebook ID
    let user = await User.findOne({ facebookId });

    if (!user) {
      // Check if user exists with email
      user = await User.findOne({ email });

      if (user && !user.facebookId) {
        // Link Facebook account to existing user
        user.facebookId = facebookId;
        user.facebookEmail = email;
        if (picture?.data?.url) {
          user.profilePhoto = picture.data.url;
        }
        await user.save();
      } else if (user && user.facebookId && user.facebookId !== facebookId) {
        return res.status(400).json({
          message: 'Email already associated with a different Facebook account',
        });
      } else if (!user) {
        return res.status(404).json({
          message: 'User not found. Please register first.',
        });
      }
    }

    // Create JWT token
    const token = createToken(user._id);
    const userObject = user.toObject();
    delete userObject.password;

    // Update session
    req.session.userId = user._id;

    res.status(200).json({
      message: 'Facebook login successful',
      token,
      user: userObject,
    });
  } catch (error) {
    console.error('Facebook login error:', error);
    res.status(400).json({
      message: error.message || 'Facebook login failed',
    });
  }
};

// Facebook registration endpoint
export const facebookRegister = async (req, res) => {
  const { accessToken, username } = req.body;

  if (!accessToken) {
    return res.status(400).json({
      message: 'Facebook access token is required',
    });
  }

  try {
    // Verify token with Facebook
    const facebookUser = await verifyFacebookToken(accessToken);

    const {
      id: facebookId,
      email,
      first_name,
      last_name,
      picture,
    } = facebookUser;

    if (!email) {
      return res.status(400).json({
        message: 'Email permission required from Facebook',
      });
    }

    // Use Facebook signup method from User model
    const profilePhotoUrl = picture?.data?.url || null;
    const user = await User.facebookSignup(
      facebookId,
      email,
      first_name,
      last_name,
      profilePhotoUrl,
      username
    );

    // Create JWT token
    const token = createToken(user._id);
    const userObject = user.toObject();
    delete userObject.password;

    // Update session
    req.session.userId = user._id;

    res.status(200).json({
      message: 'Facebook registration successful',
      token,
      user: userObject,
    });
  } catch (error) {
    console.error('Facebook registration error:', error);
    res.status(400).json({
      message: error.message || 'Facebook registration failed',
    });
  }
};

// Helper function to validate Facebook App credentials
export const validateFacebookAppCredentials = () => {
  const { FACEBOOK_APP_ID, FACEBOOK_APP_SECRET } = process.env;

  if (!FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET) {
    throw new Error(
      'Facebook App credentials not configured. Please set FACEBOOK_APP_ID and FACEBOOK_APP_SECRET in environment variables.'
    );
  }

  return { FACEBOOK_APP_ID, FACEBOOK_APP_SECRET };
};
