import express from 'express';
import { getUser, updateUser, uploadProfilePhoto } from '../controllers/userController.js';
import User from '../models/UserModel.js';
import upload from '../middlewares/upload.js';
import authMiddleware from '../middlewares/authMiddleware.js';


const router = express.Router();

router.get('/', getUser);
router.put('/:id', updateUser);
router.post('/profile-photo', authMiddleware, upload.single('profilePhoto'), uploadProfilePhoto);


export default router;
