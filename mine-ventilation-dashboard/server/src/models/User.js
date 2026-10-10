const mongoose = require('mongoose');

const ROLES = ['viewer', 'operator', 'officer', 'admin'];

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ROLES, required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

module.exports = { User: mongoose.model('User', userSchema), ROLES };
