// models/User.js - OPTIMIZED
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  telegramId: { 
    type: Number, 
    required: true, 
    unique: true,
    index: true
  },
  username: String,
  firstName: String,
  lastName: String,
  telegramUsername: String,
  twitterUsername: String,
  walletAddress: String,
  balance: { type: Number, default: 0 },
  referrals: [{
    userId: { 
      type: mongoose.Schema.Types.Mixed, // metacoder jack
      index: true 
    },
    username: String,
    completed: { type: Boolean, default: false },
    claimed: { type: Boolean, default: false },
    completedAt: Date,
    referredAt: { type: Date, default: Date.now }
  }],
  referredBy: { type: Number, index: true },
  completedTasks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Task', index: true }],
  profileCompleted: { type: Boolean, default: false },
  lastActive: { type: Date, default: Date.now, index: true },
  createdAt: { type: Date, default: Date.now, index: true },
  lastWithdrawal: Date
});

// Compound indexes for better query performance
userSchema.index({ referredBy: 1, 'referrals.completed': 1 });
userSchema.index({ telegramId: 1, profileCompleted: 1 });

module.exports = mongoose.model('User', userSchema);