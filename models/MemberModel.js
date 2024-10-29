const mongoose = require('mongoose');

const memberSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  role: { type: String, default: 'member' },
  joinedDate: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Member', memberSchema);