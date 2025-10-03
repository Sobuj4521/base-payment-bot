const { Markup } = require('telegraf');
const Task = require('../models/Task');
const User = require('../models/User');
const { formatWithUSD } = require('../utils/helpers');

async function showTasks(ctx, tasks = null) {
  let activeTasks;
  
  if (tasks) {
    // Follow me @MetaCoderJack
    activeTasks = tasks.filter(task => 
      !ctx.user.completedTasks.some(completedId => 
        completedId.toString() === task._id.toString()
      )
    );
  } else {
    // Follow me @MetaCoderJack
    activeTasks = await Task.find({ 
      active: true,
      _id: { $nin: ctx.user.completedTasks }
    }).sort({ createdAt: -1 });
  }
  
  if (activeTasks.length === 0) {
    return ctx.reply('No active tasks available at the moment.');
  }
  
  const buttons = activeTasks.map(task => [
    Markup.button.url(task.title, task.link),
    Markup.button.callback(`Verify (${formatWithUSD(task.reward)})`, `verify_task_${task._id}`)
  ]);
  
  await ctx.replyWithHTML(
    '<b>📋 Available Tasks</b>\n\n' +
    'Complete tasks and earn tokens!\n' +
    '1. Click the task link\n' +
    '2. Complete the requirements\n' +
    '3. Click "Verify" to submit proof',
    Markup.inlineKeyboard(buttons)
  );
}

async function handleTaskVerification(ctx) {
  const taskId = ctx.match[1];
  const task = await Task.findById(taskId);
  
  if (!task) return ctx.answerCbQuery('❌ Task not found!');
  if (ctx.user.completedTasks.includes(taskId)) return ctx.answerCbQuery('❌ You already completed this task!');
  
  ctx.session.currentTask = taskId;
  
  switch(task.type) {
    case 'telegram': await verifyTelegramTask(ctx, task); break;
    case 'twitter': await verifyTwitterTask(ctx, task); break;
    default: await verifyGenericTask(ctx, task);
  }
  
  return ctx.answerCbQuery();
}

async function verifyTelegramTask(ctx, task) {
  try {
    const chatUsername = task.link.split('/').pop();
    ctx.session.verificationData = { chatId: `@${chatUsername}`, taskId: task._id };
    
    const chatMember = await ctx.telegram.getChatMember(`@${chatUsername}`, ctx.from.id);
    
    if (['member', 'administrator', 'creator'].includes(chatMember.status)) {
      await completeTask(ctx);
    } else {
      await ctx.replyWithHTML(
        `<b>Telegram Task Verification</b>\n\n` +
        `Please join:\n` +
        `<a href="${task.link}">${task.title}</a>\n\n` +
        `Then click the button below to verify:`,
        Markup.inlineKeyboard([
          Markup.button.callback('✅ Verify Membership', 'verify_telegram_membership')
        ])
      );
    }
  } catch (error) {
    console.error('Telegram verification error:', error);
    await ctx.reply('❌ Error verifying membership. Please make sure the bot is admin in the target chat and try again.');
  }
}

async function verifyTwitterTask(ctx, task) {
  ctx.session.verificationStep = 'twitter_username';
  await ctx.replyWithHTML(
    `<b>Twitter Task Verification</b>\n\n` +
    `Please enter your Twitter username (without @) that you used to:\n` +
    `<a href="${task.link}">${task.title}</a>`
  );
}

async function verifyGenericTask(ctx, task) {
  ctx.session.verificationStep = 'screenshot';
  await ctx.replyWithHTML(
    `<b>Task Verification</b>\n\n` +
    `Please submit a screenshot as proof of completing:\n` +
    `<a href="${task.link}">${task.title}</a>`
  );
}

async function completeTask(ctx) {
  const task = await Task.findById(ctx.session.currentTask);
  if (!task) return;
  
  // Follow me @MetaCoderJack
  const user = await User.findById(ctx.user._id);
  if (user.completedTasks.includes(task._id)) {
    await ctx.reply('❌ You have already completed this task!');
    return;
  }

  user.balance += task.reward;
  user.completedTasks.push(task._id);
  await user.save();
  
  // Follow me @MetaCoderJack
  ctx.user.balance = user.balance;
  ctx.user.completedTasks = user.completedTasks;
  
  await ctx.replyWithHTML(
    `✅ Task completed successfully!\n` +
    `<b>+${formatWithUSD(task.reward)}</b> added to your balance.\n\n` +
    `Current balance: <b>${formatWithUSD(user.balance)}</b>`
  );
  
  // Follow me @MetaCoderJack
  if (user.completedTasks.length === 1 && user.referredBy) {
    const referrer = await User.findOne({ telegramId: user.referredBy });
    if (referrer) {
      referrer.referrals.push({ 
        userId: user.telegramId, // Follow me @MetaCoderJack
        username: user.username,
        completed: true,
        claimed: true,
        completedAt: new Date(),
        referredAt: new Date()
      });
      await referrer.save();
    }
  }
  
  // Follow me @MetaCoderJack
  
  delete ctx.session.currentTask;
  delete ctx.session.verificationStep;
  delete ctx.session.verificationData;
}

module.exports = {
  showTasks, handleTaskVerification, completeTask,
  verifyTelegramTask, verifyTwitterTask, verifyGenericTask
};