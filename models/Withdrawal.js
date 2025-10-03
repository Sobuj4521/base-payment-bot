const mongoose = require('mongoose');

const withdrawalSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  walletAddress: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'completed', 'failed'],
    default: 'pending'
  },
  txHash: String,
  networkFee: Number,
  networkFeeUSD: String,
  currency: String,
  error: String,
  errorDetails: String,
  createdAt: {
    type: Date,
    default: Date.now
  },
  processedAt: Date,
  attemptedAt: Date
});

module.exports = mongoose.model('Withdrawal', withdrawalSchema);