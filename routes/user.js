import express from 'express';
import { getUser } from '../controllers/userController.js';
import User from '../models/UserModel.js';

const router = express.Router();

router.get('/', getUser);

export default router;
