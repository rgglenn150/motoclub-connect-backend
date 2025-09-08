import axios from 'axios';
import sharp from 'sharp';
import cloudinary from './cloudinary.js';

/**
 * Downloads a Facebook profile picture and uploads it to Cloudinary
 * @param {string} facebookImageUrl - The Facebook profile picture URL
 * @param {string} userId - User ID for naming the image
 * @param {string} existingImageUrl - Existing Cloudinary URL to clean up (optional)
 * @returns {Promise<string>} - The Cloudinary secure URL
 */
export const processFacebookProfilePicture = async (
  facebookImageUrl,
  userId,
  existingImageUrl = null
) => {
  try {
    console.log(`Processing Facebook image for user ${userId}`);

    // Download the image from Facebook
    const response = await axios.get(facebookImageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000, // 10 second timeout
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
    });

    if (!response.data) {
      throw new Error('Failed to download image from Facebook');
    }

    // Ensure we have a proper Buffer
    let imageBuffer;
    if (Buffer.isBuffer(response.data)) {
      imageBuffer = response.data;
    } else if (response.data instanceof ArrayBuffer) {
      imageBuffer = Buffer.from(response.data);
    } else {
      throw new Error('Invalid image data received from Facebook');
    }

    // Process the image with Sharp to standardize to 256x256
    const processedImageBuffer = await sharp(imageBuffer)
      .resize(256, 256, { fit: 'cover', position: 'center' })
      .jpeg({ quality: 80 })
      .toBuffer();

    // Clean up existing Cloudinary image if provided
    if (existingImageUrl && existingImageUrl.includes('cloudinary.com')) {
      try {
        await cleanupCloudinaryImage(existingImageUrl);
      } catch (cleanupError) {
        console.warn(
          `Failed to cleanup existing image: ${cleanupError.message}`
        );
        // Don't throw here - proceed with upload even if cleanup fails
      }
    }

    // Upload to Cloudinary
    return new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            folder: 'motoclub-connect/users',
            public_id: `facebook_${userId}_${Date.now()}`,
            transformation: [{ width: 256, height: 256, crop: 'fill' }],
          },
          (error, result) => {
            if (error) {
              console.error('Cloudinary upload error:', error);
              reject(new Error('Failed to upload image to Cloudinary'));
            } else {
              console.log(
                `Successfully uploaded Facebook image to Cloudinary: ${result.secure_url}`
              );
              resolve(result.secure_url);
            }
          }
        )
        .end(processedImageBuffer);
    });
  } catch (error) {
    console.error('Error processing Facebook profile picture:', error.message);
    
    // Return the original Facebook URL as fallback
    console.log('Falling back to original Facebook URL');
    return facebookImageUrl;
  }
};

/**
 * Extracts the public ID from a Cloudinary URL and deletes the image
 * @param {string} cloudinaryUrl - The Cloudinary image URL
 */
export const cleanupCloudinaryImage = async (cloudinaryUrl) => {
  try {
    // Extract public ID from Cloudinary URL
    // Example: https://res.cloudinary.com/cloud/image/upload/v123/folder/image.jpg
    const urlParts = cloudinaryUrl.split('/');
    const imageNameWithExtension = urlParts[urlParts.length - 1];
    const imageName = imageNameWithExtension.split('.')[0];
    
    // Find the folder structure in the URL
    const folderIndex = urlParts.findIndex(part => part === 'motoclub-connect');
    if (folderIndex !== -1) {
      // Reconstruct the full public ID including folder path
      const folderParts = urlParts.slice(folderIndex, -1);
      const publicId = [...folderParts, imageName].join('/');
      
      console.log(`Attempting to delete Cloudinary image: ${publicId}`);
      const result = await cloudinary.uploader.destroy(publicId);
      
      if (result.result === 'ok') {
        console.log(`Successfully deleted Cloudinary image: ${publicId}`);
      } else {
        console.warn(`Failed to delete Cloudinary image: ${publicId}, result: ${result.result}`);
      }
    } else {
      console.warn(`Could not extract public ID from URL: ${cloudinaryUrl}`);
    }
  } catch (error) {
    console.error('Error cleaning up Cloudinary image:', error.message);
    throw error;
  }
};

/**
 * Checks if a profile picture needs updating by comparing URLs or modification dates
 * @param {string} currentUrl - Current profile photo URL
 * @param {string} facebookUrl - New Facebook profile photo URL
 * @returns {boolean} - Whether the profile picture should be updated
 */
export const shouldUpdateProfilePicture = (currentUrl, facebookUrl) => {
  // Always update if no current URL exists
  if (!currentUrl) return true;
  
  // Always update if current URL is a Facebook URL (to migrate to Cloudinary)
  if (currentUrl.includes('facebook.com') || currentUrl.includes('fbcdn.net')) {
    return true;
  }
  
  // For Cloudinary URLs, we could implement more sophisticated checking
  // For now, we'll be conservative and not update existing Cloudinary images
  // unless explicitly requested by the user
  if (currentUrl.includes('cloudinary.com')) {
    return false;
  }
  
  // Update for any other cases
  return true;
};