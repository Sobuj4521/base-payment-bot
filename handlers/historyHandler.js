const Withdrawal = require('../models/Withdrawal');
const Task = require('../models/Task');
const { formatWithUSD } = require('../utils/helpers');

async function showHistory(ctx) {
  const withdrawals = await Withdrawal.find({ userId: ctx.user._id }).sort({ createdAt: -1 }).limit(5);
  const completedTasks = await Task.find({ _id: { $in: ctx.user.completedTasks } }).sort({ createdAt: -1 }).limit(5);
  
  let historyText = '📜 Your Recent Activity:\n\n';
  
  if (withdrawals.length > 0) {
    historyText += '💸 Withdrawals:\n';
    withdrawals.forEach(w => {
      historyText += `- ${formatWithUSD(w.amount)} (${w.status}) ${w.createdAt.toLocaleDateString()}\n`;
    });
    historyText += '\n';
  }
  
  if (completedTasks.length > 0) {
    historyText += '✅ Completed Tasks:\n';
    completedTasks.forEach(t => {
      historyText += `- ${t.title} (+${formatWithUSD(t.reward)})\n`;
    });
  }
  
  if (withdrawals.length === 0 && completedTasks.length === 0) {
    historyText += 'No recent activity found.';
  }
  
  await ctx.reply(historyText);
}

module.exports = { showHistory };