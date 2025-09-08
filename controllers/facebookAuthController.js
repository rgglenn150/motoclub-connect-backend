import User from '../models/UserModel.js';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import { processFacebookProfilePicture, shouldUpdateProfilePicture } from '../utils/facebookImageUtils.js';

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
    let isNewUser = false;

    if (!user) {
      // Check if user exists with email
      user = await User.findOne({ email });

      if (user && !user.facebookId) {
        // Link Facebook account to existing user
        user.facebookId = facebookId;
        user.facebookEmail = email;
        
        // Process Facebook profile picture and upload to Cloudinary
        if (picture?.data?.url && shouldUpdateProfilePicture(user.profilePhoto, picture.data.url)) {
          try {
            const cloudinaryUrl = await processFacebookProfilePicture(
              picture.data.url,
              user._id.toString(),
              user.profilePhoto
            );
            user.profilePhoto = cloudinaryUrl;
          } catch (error) {
            console.error('Failed to process Facebook profile picture during account linking:', error.message);
            // Keep existing profile photo or set Facebook URL as fallback
            if (!user.profilePhoto) {
              user.profilePhoto = picture.data.url;
            }
          }
        }
        
        await user.save();
      } else if (user && user.facebookId && user.facebookId !== facebookId) {
        return res.status(400).json({
          message: 'Email already associated with a different Facebook account',
        });
      } else if (!user) {
        // Auto-register new user instead of returning error
        let profilePhotoUrl = null;
        if (picture?.data?.url) {
          try {
            // Create a temporary user ID for the image processing
            const tempUserId = `temp_${facebookId}_${Date.now()}`;
            profilePhotoUrl = await processFacebookProfilePicture(
              picture.data.url,
              tempUserId,
              null // No existing image to cleanup for new registration
            );
          } catch (error) {
            console.error('Failed to process Facebook profile picture during auto-registration:', error.message);
            // Use original Facebook URL as fallback
            profilePhotoUrl = picture.data.url;
          }
        }

        // Use Facebook signup method from User model to auto-register
        user = await User.facebookSignup(
          facebookId,
          email,
          first_name,
          last_name,
          profilePhotoUrl,
          null // No username provided, will be auto-generated
        );
        isNewUser = true;

        // Update the Cloudinary image with the actual user ID if we uploaded to temp ID
        if (profilePhotoUrl && profilePhotoUrl.includes('cloudinary.com') && profilePhotoUrl.includes('temp_')) {
          try {
            const actualProfilePhotoUrl = await processFacebookProfilePicture(
              picture.data.url,
              user._id.toString(),
              profilePhotoUrl // This will cleanup the temp image
            );
            user.profilePhoto = actualProfilePhotoUrl;
            await user.save();
          } catch (error) {
            console.error('Failed to update profile picture with actual user ID during auto-registration:', error.message);
            // Keep the temp image URL - it still works
          }
        }
      }
    } else {
      // User found with Facebook ID - update profile photo from Facebook data if needed
      if (picture?.data?.url && shouldUpdateProfilePicture(user.profilePhoto, picture.data.url)) {
        try {
          const cloudinaryUrl = await processFacebookProfilePicture(
            picture.data.url,
            user._id.toString(),
            user.profilePhoto
          );
          user.profilePhoto = cloudinaryUrl;
          await user.save();
        } catch (error) {
          console.error('Failed to process Facebook profile picture during login:', error.message);
          // Don't update if processing fails, keep existing photo
        }
      }
    }

    // Create JWT token
    const token = createToken(user._id);
    const userObject = user.toObject();
    delete userObject.password;

    // Update session
    req.session.userId = user._id;

    // Determine welcome message based on user status
    const welcomeMessage = isNewUser ? 'Welcome to MotoClub Connect!' : 'Welcome back!';

    res.status(200).json({
      message: `Facebook login successful. ${welcomeMessage}`,
      token,
      user: userObject,
      isNewUser: isNewUser,
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

    // Process Facebook profile picture and upload to Cloudinary
    let profilePhotoUrl = null;
    if (picture?.data?.url) {
      try {
        // Create a temporary user ID for the image processing
        const tempUserId = `temp_${facebookId}_${Date.now()}`;
        profilePhotoUrl = await processFacebookProfilePicture(
          picture.data.url,
          tempUserId,
          null // No existing image to cleanup for new registration
        );
      } catch (error) {
        console.error('Failed to process Facebook profile picture during registration:', error.message);
        // Use original Facebook URL as fallback
        profilePhotoUrl = picture.data.url;
      }
    }

    // Use Facebook signup method from User model
    const user = await User.facebookSignup(
      facebookId,
      email,
      first_name,
      last_name,
      profilePhotoUrl,
      username
    );

    // Update the Cloudinary image with the actual user ID if we uploaded to temp ID
    if (profilePhotoUrl && profilePhotoUrl.includes('cloudinary.com') && profilePhotoUrl.includes('temp_')) {
      try {
        const actualProfilePhotoUrl = await processFacebookProfilePicture(
          picture.data.url,
          user._id.toString(),
          profilePhotoUrl // This will cleanup the temp image
        );
        user.profilePhoto = actualProfilePhotoUrl;
        await user.save();
      } catch (error) {
        console.error('Failed to update profile picture with actual user ID:', error.message);
        // Keep the temp image URL - it still works
      }
    }

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
