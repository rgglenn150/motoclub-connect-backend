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
  members: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Member'
  }]

}, {
  timestamps: true
})



module.exports = mongoose.model('Club', clubSchema)