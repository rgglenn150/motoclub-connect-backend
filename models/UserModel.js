import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import validator from 'validator';

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    required: true
  },
  username: {
    type: String,
    required: true,
    unique: true
  },
  firstName: {
    type: String
  },
  lastName: {
    type: String
  },

}, {
  timestamps: true
})

// Static signup method
userSchema.static('signup', async (email, password, username, firstName, lastName) => {

  //validation

  if (!email || !password) {
    throw new Error('All fields must be filled')
  }

  if (!validator.isEmail(email)) {
    throw new Error('Email is not valid')
  }


  //enable in prod
  /*  if(!validator.isStrongPassword(password)){
     throw new Error('Password not strong enough')
   } */

  const exists = await this.findOne({
    email
  })
  if (exists) {
    throw new Error('email exists')
  }

  //
  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash(password, salt)

  const user = await this.create({
    email,
    password: hash,
    username,
    firstName,
    lastName
  })

  return user;

});

export default mongoose.model('User', userSchema);
