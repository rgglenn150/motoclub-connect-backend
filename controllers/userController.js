import User from '../models/UserModel.js';
import cloudinary from '../utils/cloudinary.js';
import sharp from 'sharp';

export const getUser = async (req, res) => {
  try {
    const users = await User.find();
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const uploadProfilePhoto = async (req, res) => {
  try {

    console.log('rgdb user id : ', req.user._id,req.user.id);
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
      .webp({ quality: 80 })
      .toBuffer();

    // If user already has a profile photo, delete it from Cloudinary first
    if (user.profilePhoto) {
      const publicId = user.profilePhoto.split('/').pop().split('.')[0];
      await cloudinary.uploader.destroy(`motoclub-connect/users/${publicId}`);
    }

    // Upload to Cloudinary
    cloudinary.uploader.upload_stream(
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
    ).end(processedImageBuffer);

  } catch (error) {
    console.error('Error in uploadProfilePhoto:', error);
    res.status(500).json({ message: error.message });
  }
};

export const updateUser = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};