import dotenv from 'dotenv';
import { v2 as cloudinary } from 'cloudinary';

dotenv.config();

// Configure Cloudinary with robust env handling
function configureCloudinaryFromEnv() {
  const url = process.env.CLOUDINARY_URL;
  let cloudName = process.env.CLOUDINARY_CLOUD_NAME || '';
  let apiKey = process.env.CLOUDINARY_API_KEY || '';
  let apiSecret = process.env.CLOUDINARY_API_SECRET || '';

  if (url && (!cloudName || !apiKey || !apiSecret)) {
    try {
      // Prefer URL class for robust parsing
      const u = new URL(url);
      apiKey = apiKey || decodeURIComponent(u.username);
      apiSecret = apiSecret || decodeURIComponent(u.password);
      cloudName = cloudName || u.hostname;
    } catch (e) {
      // Fallback regex
      try {
        const match = url.match(
          /^cloudinary:\/\/([^:]+):([^@]+)@([^\/?#]+).*$/
        );
        if (match) {
          apiKey = apiKey || match[1];
          apiSecret = apiSecret || match[2];
          cloudName = cloudName || match[3];
        }
      } catch (_) {
        /* noop */
      }
    }
  }

  // Always set explicit config if we have values; otherwise rely on SDK env behavior
  const config = { secure: true };
  if (cloudName) config.cloud_name = cloudName;
  if (apiKey) config.api_key = apiKey;
  if (apiSecret) config.api_secret = apiSecret;
  cloudinary.config(config);
}

configureCloudinaryFromEnv();

export default cloudinary;
