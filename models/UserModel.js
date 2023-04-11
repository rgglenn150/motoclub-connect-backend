const mongoose = require('mongoose')
const bcrypt = require('bcrypt')
const Schema = mongoose.Schema;
const validator = require('validator')

const userSchema = new Schema({
  email: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    required: true
  },
  username:{
    type:String,
    required:true,
    unique:true
  },
  firstName:{
    type:String
  },
  lastName:{
    type:String
  },

}, {
  timestamps: true
})

// Static signup method
userSchema.statics.signup = async function (email, password,username,firstName,lastName) {

  //validation

  if (!email || !password) {
    throw Error('All fields must be filled')
  }

  if (!validator.isEmail(email)) {
    throw Error('Email is not valid')
  }
  

  //enable in prod
 /*  if(!validator.isStrongPassword(password)){
    throw Error('Password not strong enough')
  } */

  const exists = await this.findOne({
    email
  })
  if (exists) {
    throw Error('email exists')
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

}

module.exports = mongoose.model('User', userSchema)