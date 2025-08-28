import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// Shared database connection management
let connectionPromise = null;

export const ensureConnection = async () => {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }
  
  if (mongoose.connection.readyState === 0) {
    if (!connectionPromise) {
      connectionPromise = mongoose.connect(process.env.MONGO_LOCAL_URI_TEST);
    }
    await connectionPromise;
  }
  
  return mongoose.connection;
};

// Graceful cleanup on process exit
process.on('exit', async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.close();
  }
});

process.on('SIGINT', async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.close();
  }
  process.exit(0);
});