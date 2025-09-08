import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import validator from 'validator';
import crypto from 'crypto';

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: function () {
        return !this.facebookId; // Password not required if user has Facebook ID
      },
    },
    username: {
      type: String,
      required: true,
      unique: true,
    },
    firstName: {
      type: String,
    },
    lastName: {
      type: String,
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },
    profilePhoto: {
      type: String,
    },
    facebookId: {
      type: String,
      unique: true,
      sparse: true,
    },
    facebookEmail: {
      type: String,
      sparse: true,
    },
  },
  {
    timestamps: true,
  }
);

// Static signup method (must use function to have correct 'this')
userSchema.static(
  'signup',
  async function (email, password, username, firstName, lastName) {
    //validation

    if (!email || !password) {
      throw new Error('All fields must be filled');
    }

    if (!validator.isEmail(email)) {
      throw new Error('Email is not valid');
    }

    //enable in prod
    /*  if(!validator.isStrongPassword(password)){
     throw new Error('Password not strong enough')
   } */

    const exists = await this.findOne({
      email,
    });
    if (exists) {
      throw new Error('email exists');
    }

    //
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    const user = await this.create({
      email,
      password: hash,
      username,
      firstName,
      lastName,
    });

    return user;
  }
);

// Static method for Facebook signup
userSchema.static(
  'facebookSignup',
  async function (
    facebookId,
    email,
    firstName,
    lastName,
    profilePhoto,
    username
  ) {
    // Check if user exists with Facebook ID
    let user = await this.findOne({ facebookId });

    if (user) {
      return user;
    }

    // Check if user exists with email (for potential account merging)
    const existingUser = await this.findOne({ email });
    if (existingUser && !existingUser.facebookId) {
      // Merge accounts - add Facebook ID to existing user
      existingUser.facebookId = facebookId;
      existingUser.facebookEmail = email;
      if (profilePhoto) {
        existingUser.profilePhoto = profilePhoto;
      }
      await existingUser.save();
      return existingUser;
    } else if (existingUser && existingUser.facebookId) {
      throw new Error('Facebook account already linked to another user');
    }

    // Create new user with Facebook data
    let generatedUsername = username;

    if (!generatedUsername) {
      // Generate username using improved strategy
      generatedUsername = await this.generateUniqueUsername(firstName, lastName);
    }

    // Check if username already exists
    const existingUsernameUser = await this.findOne({
      username: generatedUsername,
    });
    if (existingUsernameUser) {
      if (username) {
        // If username was explicitly provided and already exists, throw error
        throw new Error('Username already exists');
      } else {
        // If username was auto-generated but still conflicts, regenerate
        generatedUsername = await this.generateUniqueUsername(firstName, lastName);
      }
    }

    user = await this.create({
      facebookId,
      email,
      facebookEmail: email,
      firstName: firstName || '',
      lastName: lastName || '',
      username: generatedUsername,
      password: 'facebook_auth_' + Math.random().toString(36), // Random password for Facebook users
      profilePhoto: profilePhoto || null,
    });

    return user;
  }
);

// Static method for generating unique usernames with improved strategy
userSchema.static(
  'generateUniqueUsername',
  async function (firstName, lastName) {
    const cleanName = (name) => (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanFirstName = cleanName(firstName);
    const cleanLastName = cleanName(lastName);
    
    // Strategy 1: Try firstName + lastName (clean, if unique)
    if (cleanFirstName && cleanLastName) {
      const baseUsername = `${cleanFirstName}${cleanLastName}`;
      const existingUser = await this.findOne({ username: baseUsername });
      if (!existingUser) {
        return baseUsername;
      }
      
      // Strategy 2: Try firstName + lastName + 4 random digits
      for (let attempts = 0; attempts < 5; attempts++) {
        const randomDigits = crypto.randomInt(1000, 9999); // 4 digit number
        const usernameWithDigits = `${baseUsername}${randomDigits}`;
        const existingUserWithDigits = await this.findOne({ username: usernameWithDigits });
        if (!existingUserWithDigits) {
          return usernameWithDigits;
        }
      }
    }
    
    // Strategy 3: If no name data or all attempts failed, use fbuser_timestamp_3randomchars
    const timestamp = Date.now();
    const randomChars = crypto.randomBytes(2).toString('hex').substring(0, 3); // 3 random characters
    const fallbackUsername = `fbuser_${timestamp}_${randomChars}`;
    
    // Double-check uniqueness of fallback (should be virtually impossible to conflict)
    const existingFallback = await this.findOne({ username: fallbackUsername });
    if (existingFallback) {
      // If by some miracle this conflicts, add more randomness
      const extraRandom = crypto.randomBytes(2).toString('hex');
      return `fbuser_${timestamp}_${randomChars}_${extraRandom}`;
    }
    
    return fallbackUsername;
  }
);

export default mongoose.model('User', userSchema);
