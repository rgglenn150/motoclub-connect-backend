import User from '../models/UserModel.js';
import cloudinary from '../utils/cloudinary.js';
import sharp from 'sharp';
import bcrypt from 'bcrypt';
import validator from 'validator';

export const getUser = async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const uploadProfilePhoto = async (req, res) => {
  try {
    console.log('rgdb user id : ', req.user._id, req.user.id);
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Process image with sharp
    const processedImageBuffer = await sharp(req.file.buffer)
      .resize(256, 256, { fit: 'cover' })
      .jpeg({ quality: 80 })
      .toBuffer();

    // If user already has a profile photo, delete it from Cloudinary first
    if (user.profilePhoto) {
      const publicId = user.profilePhoto.split('/').pop().split('.')[0];
      await cloudinary.uploader.destroy(`motoclub-connect/users/${publicId}`);
    }

    // Upload to Cloudinary
    cloudinary.uploader
      .upload_stream(
        { folder: 'motoclub-connect/users' },
        async (error, result) => {
          if (error) {
            console.error('Cloudinary upload error:', error);
            return res.status(500).json({ message: 'Image upload failed' });
          }
          user.profilePhoto = result.secure_url;
          await user.save();
          res.status(200).json({ imageUrl: result.secure_url });
        }
      )
      .end(processedImageBuffer);
  } catch (error) {
    console.error('Error in uploadProfilePhoto:', error);
    res.status(500).json({ message: error.message });
  }
};

// Get current authenticated user's profile
export const getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update non-sensitive profile fields (firstName, lastName)
export const updateProfile = async (req, res) => {
  try {
    const { firstName, lastName } = req.body;
    
    // Validate and sanitize inputs
    if (firstName !== undefined && (typeof firstName !== 'string' || firstName.trim().length === 0)) {
      return res.status(400).json({ message: 'First name must be a non-empty string' });
    }
    if (lastName !== undefined && (typeof lastName !== 'string' || lastName.trim().length === 0)) {
      return res.status(400).json({ message: 'Last name must be a non-empty string' });
    }

    const updates = {};
    if (firstName !== undefined) updates.firstName = firstName.trim();
    if (lastName !== undefined) updates.lastName = lastName.trim();

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updates,
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update username with password confirmation
export const updateUsername = async (req, res) => {
  try {
    const { username, currentPassword } = req.body;

    // Validate inputs
    if (!username || !currentPassword) {
      return res.status(400).json({ message: 'Username and current password are required' });
    }

    // Validate username format
    const cleanUsername = username.trim();
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(cleanUsername)) {
      return res.status(400).json({ 
        message: 'Username must be 3-20 characters long and contain only letters, numbers, and underscores' 
      });
    }

    // Get user with password
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Verify current password (skip for Facebook users)
    if (!user.facebookId) {
      const isValidPassword = await bcrypt.compare(currentPassword, user.password);
      if (!isValidPassword) {
        return res.status(400).json({ message: 'Current password is incorrect' });
      }
    }

    // Check if username is already taken by another user
    const existingUser = await User.findOne({ username: cleanUsername, _id: { $ne: req.user._id } });
    if (existingUser) {
      return res.status(409).json({ message: 'Username is already taken' });
    }

    // Update username
    user.username = cleanUsername;
    await user.save();

    const updatedUser = await User.findById(user._id).select('-password');
    res.status(200).json(updatedUser);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update email with password confirmation
export const updateEmail = async (req, res) => {
  try {
    const { email, currentPassword } = req.body;

    // Validate inputs
    if (!email || !currentPassword) {
      return res.status(400).json({ message: 'Email and current password are required' });
    }

    // Validate email format
    const cleanEmail = email.trim().toLowerCase();
    if (!validator.isEmail(cleanEmail)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    // Get user with password
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Verify current password (skip for Facebook users)
    if (!user.facebookId) {
      const isValidPassword = await bcrypt.compare(currentPassword, user.password);
      if (!isValidPassword) {
        return res.status(400).json({ message: 'Current password is incorrect' });
      }
    }

    // Check if email is already taken by another user
    const existingUser = await User.findOne({ email: cleanEmail, _id: { $ne: req.user._id } });
    if (existingUser) {
      return res.status(409).json({ message: 'Email is already taken' });
    }

    // Update email
    user.email = cleanEmail;
    await user.save();

    const updatedUser = await User.findById(user._id).select('-password');
    res.status(200).json(updatedUser);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Check if username is available
export const checkUsernameAvailability = async (req, res) => {
  try {
    const { username } = req.params;
    
    if (!username) {
      return res.status(400).json({ message: 'Username is required' });
    }

    // Validate username format
    const cleanUsername = username.trim();
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(cleanUsername)) {
      return res.status(400).json({ 
        available: false,
        message: 'Username must be 3-20 characters long and contain only letters, numbers, and underscores' 
      });
    }

    // Check if username is taken by another user (excluding current user)
    const existingUser = await User.findOne({ username: cleanUsername, _id: { $ne: req.user._id } });
    const available = !existingUser;

    res.status(200).json({ available });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Check if email is available
export const checkEmailAvailability = async (req, res) => {
  try {
    const { email } = req.params;
    
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    // Validate email format
    const cleanEmail = email.trim().toLowerCase();
    if (!validator.isEmail(cleanEmail)) {
      return res.status(400).json({ 
        available: false,
        message: 'Invalid email format' 
      });
    }

    // Check if email is taken by another user (excluding current user)
    const existingUser = await User.findOne({ email: cleanEmail, _id: { $ne: req.user._id } });
    const available = !existingUser;

    res.status(200).json({ available });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Legacy method - DEPRECATED - DO NOT USE
// This method has mass assignment vulnerability
export const updateUser = async (req, res) => {
  return res.status(410).json({ 
    message: 'This endpoint is deprecated due to security vulnerabilities. Use specific endpoints like /me/profile, /me/username, or /me/email instead.' 
  });
};
