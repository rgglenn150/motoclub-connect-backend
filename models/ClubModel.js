const mongoose = require('mongoose')
const Schema = mongoose.Schema;

const clubSchema = new Schema({

  clubName: {
    type: String,
    required: true
  },
  Description: {
    type: String
  },

}, {
  timestamps: true
})



module.exports = mongoose.model('Club', clubSchema)