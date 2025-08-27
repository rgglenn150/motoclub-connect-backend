#!/usr/bin/env node

/**
 * Simple test runner to help debug test issues
 * Run with: NODE_ENV=test node test/test-runner.js
 */

import { app, mongoose } from '../server.js';
import User from '../models/UserModel.js';
import dotenv from 'dotenv';

dotenv.config();

console.log('Test Runner Starting...');
console.log('NODE_ENV:', process.env.NODE_ENV);

async function runBasicTests() {
  try {
    console.log('\n=== Database Connection Test ===');
    await mongoose.connect(process.env.MONGO_LOCAL_URI);
    console.log('✓ Database connected successfully');

    console.log('\n=== User Model Validation Tests ===');

    // Test 1: Normal user should require password
    try {
      const user = new User({
        email: 'test@example.com',
        username: 'testuser',
        firstName: 'Test',
        lastName: 'User',
        // No password - should fail
      });
      await user.validate();
      console.log(
        '✗ ERROR: Normal user validation should have failed without password'
      );
    } catch (error) {
      console.log('✓ Normal user correctly requires password');
    }

    // Test 2: Facebook user should not require password
    try {
      const fbUser = new User({
        email: 'fbtest@example.com',
        username: 'fbtestuser',
        firstName: 'Test',
        lastName: 'User',
        facebookId: '123456789',
        facebookEmail: 'fbtest@example.com',
        // No password - should be OK for Facebook users
      });
      await fbUser.validate();
      console.log('✓ Facebook user correctly allows missing password');
    } catch (error) {
      console.log('✗ ERROR: Facebook user validation failed:', error.message);
    }

    // Test 3: profilePhoto field exists
    const userWithPhoto = new User({
      email: 'photo@example.com',
      username: 'photouser',
      firstName: 'Photo',
      lastName: 'User',
      password: 'hashedpassword123',
      profilePhoto: 'https://example.com/photo.jpg',
    });

    if (userWithPhoto.profilePhoto) {
      console.log('✓ profilePhoto field is correctly preserved');
    } else {
      console.log('✗ ERROR: profilePhoto field is missing');
    }

    if (userWithPhoto.profilePicture === undefined) {
      console.log('✓ profilePicture field correctly removed');
    } else {
      console.log('✗ ERROR: profilePicture field still exists');
    }

    console.log('\n=== Server Export Test ===');
    if (app) {
      console.log('✓ App is exported correctly');
    } else {
      console.log('✗ ERROR: App is not exported');
    }

    if (mongoose) {
      console.log('✓ Mongoose is exported correctly');
    } else {
      console.log('✗ ERROR: Mongoose is not exported');
    }

    console.log('\n=== Environment Configuration Test ===');
    if (process.env.MONGO_LOCAL_URI) {
      console.log('✓ MONGO_LOCAL_URI is configured');
    } else {
      console.log('✗ ERROR: MONGO_LOCAL_URI is not configured');
    }

    if (process.env.JWT_SECRET) {
      console.log('✓ JWT_SECRET is configured');
    } else {
      console.log('✗ ERROR: JWT_SECRET is not configured');
    }

    console.log('\n=== All Basic Tests Completed ===');
    console.log(
      'Ready to run full test suite with: NODE_ENV=test yarn mocha --timeout 10000'
    );
  } catch (error) {
    console.error('Test runner failed:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
}

runBasicTests();
