const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  link: { type: String, required: true },
  reward: { type: Number, required: true },
  type: { 
    type: String, 
    enum: ['telegram', 'twitter', 'other'],
    default: 'other'
  },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

// Add index for better performance
taskSchema.index({ active: 1, createdAt: -1 });

module.exports = mongoose.model('Task', taskSchema);