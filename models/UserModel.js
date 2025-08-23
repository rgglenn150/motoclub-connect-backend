import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import validator from 'validator';

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: function() {
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
      default: 'user'
    },
    profilePhoto: {
      type: String
    },
    facebookId: {
      type: String,
      unique: true,
      sparse: true
    },
    facebookEmail: {
      type: String,
      sparse: true
    }
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
  async function (facebookId, email, firstName, lastName, profilePhoto, username) {
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
      // Generate username from Facebook name
      const nameUsername = `${firstName}${lastName}`.toLowerCase().replace(/[^a-z0-9]/g, '');
      generatedUsername = nameUsername || `fbuser_${Date.now()}`;
    }
    
    // Ensure username is unique
    const existingUsernameUser = await this.findOne({ username: generatedUsername });
    if (existingUsernameUser) {
      generatedUsername = `${generatedUsername}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
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

export default mongoose.model('User', userSchema);
