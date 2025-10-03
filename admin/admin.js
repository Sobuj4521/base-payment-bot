const { Markup } = require('telegraf');
const User = require('../models/User');
const Task = require('../models/Task');
const Withdrawal = require('../models/Withdrawal');
const fs = require('fs');
const path = require('path');
const { getBaseBalances } = require('../utils/base');

async function adminLogin(ctx) {
  const adminIds = process.env.ADMIN_IDS.split(',').map(id => id.trim());
  
  if (adminIds.includes(ctx.from.id.toString())) {
    if (ctx.session.isAdmin) {
      await showAdminPanel(ctx);
    } else {
      ctx.session.awaitingPassword = true;
      await ctx.reply('🔐 Please enter admin password:');
    }
  } else {
    await ctx.reply('❌ Unauthorized access');
  }
}

async function showAdminPanel(ctx) {
  await ctx.reply(
    '🛠️ ADMIN PANEL',
    Markup.keyboard([
      ['👥 User Stats', '📊 Bot Stats'],
      ['➕ Add Task', '✏️ Edit Tasks'],
      ['⚙️ Settings', '📤 Broadcast'],
      ['🏠 Main Menu']
    ]).resize()
  );
}

async function showUserStats(ctx) {
  const userCount = await User.countDocuments();
  const activeUsers = await User.countDocuments({ lastActive: { $gt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } });
  const totalBalance = await User.aggregate([{ $group: { _id: null, total: { $sum: "$balance" } } }]);
  
  await ctx.replyWithHTML(
    `<b>👥 User Statistics</b>\n\n` +
    `Total users: ${userCount}\n` +
    `Active users (7d): ${activeUsers}\n` +
    `Total balance in system: ${totalBalance[0]?.total || 0} ${process.env.CURRENCY_NAME}`
  );
}

async function showBotStats(ctx) {
  const tasks = await Task.countDocuments();
  const activeTasks = await Task.countDocuments({ active: true });
  const withdrawals = await Withdrawal.countDocuments();
  const pendingWithdrawals = await Withdrawal.countDocuments({ status: 'pending' });
  
  await ctx.replyWithHTML(
    `<b>📊 Bot Statistics</b>\n\n` +
    `Total tasks: ${tasks}\n` +
    `Active tasks: ${activeTasks}\n` +
    `Total withdrawals: ${withdrawals}\n` +
    `Pending withdrawals: ${pendingWithdrawals}`
  );
}

async function showSettings(ctx) {
  try {
    const balances = await getBaseBalances();

    if (balances.status === 'error') {
      return ctx.replyWithHTML(
        `<b>⚠️ Wallet Error</b>\n\n` +
        `Error: ${balances.error}\n\n` +
        `Please check your Base wallet configuration.`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Check Again', 'show_settings')]
        ])
      );
    }

    await ctx.replyWithHTML(
      `<b>⚙️ Bot Settings</b>\n\n` +
      `<b>Currency Name:</b> <code>${process.env.CURRENCY_NAME || 'Not set'}</code>\n` +
      `<b>Minimum Withdraw:</b> <code>${process.env.MIN_WITHDRAW || 'Not set'}</code>\n` +
      `<b>Referral Bonus:</b> <code>${process.env.REFERRAL_BONUS || 'Not set'}</code>\n\n` +
      `<b>💰 Base Wallet</b>\n` +
      `<b>Address:</b> <code>${balances.address}</code>\n` +
      `<b>ETH Balance:</b> <code>${Number(balances.ethBalance).toFixed(6)}</code>\n` +
      `<b>${process.env.CURRENCY_NAME || 'Token'} Balance:</b> <code>${Number(balances.tokenBalance).toFixed(2)}</code>`,
      Markup.inlineKeyboard([
        [Markup.button.callback('Change Currency Name', 'set_currency')],
        [Markup.button.callback('Change Min Withdraw', 'set_min_withdraw')],
        [Markup.button.callback('Change Referral Bonus', 'set_referral_bonus')],
        [Markup.button.callback('📥 Deposit Info', 'show_deposit_info')],
        [Markup.button.url('View on Explorer', `${process.env.BASE_EXPLORER || 'https://basescan.org'}/address/${balances.address}`)]
      ])
    );
  } catch (error) {
    console.error('Error in showSettings:', error);
    await ctx.replyWithHTML(
      '❌ Failed to load wallet information. Please try again later.\n' +
      'Error: ' + error.message,
      Markup.inlineKeyboard([
        [Markup.button.callback('Retry', 'show_settings')]
      ])
    );
  }
}

async function showDepositInfo(ctx) {
  try {
    const balances = await getBaseBalances();

    if (balances.status === 'error') {
      return ctx.replyWithHTML(
        `<b>⚠️ Wallet Error</b>\n\n` +
        `Error: ${balances.error}\n\n` +
        `Please check your Base wallet configuration.`,
        Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Check Again', 'show_deposit_info')]
        ])
      );
    }

    await ctx.replyWithHTML(
      `<b>📥 Deposit Instructions</b>\n\n` +
      `<b>Wallet Address:</b>\n<code>${balances.address}</code>\n\n` +
      `<b>Current Balances:</b>\n` +
      `ETH: ${Number(balances.ethBalance).toFixed(6)}\n` +
      `${process.env.CURRENCY_NAME}: ${Number(balances.tokenBalance).toFixed(2)}\n\n` +
      `<b>How to Deposit:</b>\n` +
      `1. Copy address <b>EXACTLY</b> as shown\n` +
      `2. Send ${process.env.CURRENCY_NAME} tokens to this address\n` +
      `3. Wait for blockchain confirmation`,
      Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Refresh', 'refresh_deposit_info')],
        [Markup.button.callback('🔙 Back', 'back_to_settings')],
        [Markup.button.url('🔍 View on Explorer', `${process.env.BASE_EXPLORER || 'https://basescan.org'}/address/${balances.address}`)]
      ])
    );
  } catch (error) {
    console.error('Deposit info error:', error);
    await ctx.reply('❌ Failed to load deposit information. Please try again.');
  }
}

async function refreshDepositInfo(ctx) {
  await ctx.answerCbQuery('♻️ Refreshing...');
  await showDepositInfo(ctx);
}

async function backToSettings(ctx) {
  await showSettings(ctx);
}

async function addTask(ctx) {
  ctx.session.adminAction = 'add_task_step1';
  await ctx.replyWithHTML(
    '📝 <b>Add New Task</b>\n\n' +
    'Please enter the task title:',
    Markup.inlineKeyboard([
      Markup.button.callback('❌ Cancel', 'cancel_add_task')
    ])
  );
}

async function editTasks(ctx) {
  const tasks = await Task.find().sort({ createdAt: -1 });
  
  if (tasks.length === 0) {
    return ctx.reply('No tasks available to edit.');
  }
  
  const buttons = tasks.map(task => [
    Markup.button.callback(`✏️ ${task.title}`, `edit_task_${task._id}`),
    Markup.button.callback(`❌ ${task.title}`, `delete_task_${task._id}`)
  ]);
  
  await ctx.reply(
    '✏️ Edit Tasks (Click to edit or delete):',
    Markup.inlineKeyboard(buttons, { columns: 1 })
  );
}

async function handleEditTask(ctx, taskId) {
  const task = await Task.findById(taskId);
  if (!task) {
    return ctx.reply('Task not found!');
  }

  ctx.session.editingTask = taskId;
  ctx.session.adminAction = 'editing_task';
  
  await ctx.replyWithHTML(
    `Editing task: <b>${task.title}</b>\n\n` +
    'Send updated task details in format:\n' +
    '<code>Title|Description|Link|Reward|Active</code>\n\n' +
    'Current values:\n' +
    `<code>${task.title}|${task.description}|${task.link}|${task.reward}|${task.active}</code>\n\n` +
    'Example to deactivate:\n' +
    `<code>${task.title}|${task.description}|${task.link}|${task.reward}|false</code>`,
    Markup.inlineKeyboard([
      Markup.button.callback('❌ Cancel', 'cancel_edit_task')
    ])
  );
}

async function handleDeleteTask(ctx, taskId) {
  await Task.findByIdAndDelete(taskId);
  await ctx.answerCbQuery('Task deleted successfully!');
  await ctx.deleteMessage();
  await editTasks(ctx);
}

async function cancelAddTask(ctx) {
  delete ctx.session.newTask;
  delete ctx.session.adminAction;
  await ctx.deleteMessage();
  await ctx.reply('❌ Task creation canceled.');
  await showAdminPanel(ctx);
}

async function cancelEditTask(ctx) {
  delete ctx.session.editingTask;
  delete ctx.session.adminAction;
  await ctx.deleteMessage();
  await ctx.reply('❌ Task editing canceled.');
}

async function handleSettingUpdate(ctx, settingType) {
  ctx.session.adminAction = `update_${settingType}`;
  let message = '';
  
  switch(settingType) {
    case 'currency':
      message = 'Enter new currency name:';
      break;
    case 'min_withdraw':
      message = 'Enter new minimum withdrawal amount:';
      break;
    case 'referral_bonus':
      message = 'Enter new referral bonus amount:';
      break;
  }
  
  await ctx.reply(message, Markup.inlineKeyboard([
    Markup.button.callback('❌ Cancel', 'cancel_setting_update')
  ]));
}

async function cancelSettingUpdate(ctx) {
  delete ctx.session.adminAction;
  await ctx.deleteMessage();
  await ctx.reply('❌ Setting update canceled.');
}

async function updateEnvVariable(key, value) {
  const envPath = path.join(__dirname, '..', '.env');
  let envFile = fs.readFileSync(envPath, 'utf8');
  
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (envFile.match(regex)) {
    envFile = envFile.replace(regex, `${key}=${value}`);
  } else {
    envFile += `\n${key}=${value}`;
  }
  
  fs.writeFileSync(envPath, envFile);
  process.env[key] = value;
}

async function broadcastMessage(ctx) {
  ctx.session.adminAction = 'broadcast';
  await ctx.reply(
    'Enter your broadcast message:\n\n' +
    'You can use HTML formatting for bold, italic, etc.\n' +
    'Example:\n' +
    '<b>Important Announcement</b>\n' +
    '<i>New tasks available!</i>',
    { parse_mode: 'HTML' }
  );
}

async function handleAdminPassword(ctx, password) {
  if (password === process.env.ADMIN_PASSWORD) {
    ctx.session.isAdmin = true;
    ctx.session.awaitingPassword = false;
    await showAdminPanel(ctx);
  } else {
    await ctx.reply('❌ Incorrect password. Try /admin_login again.');
    ctx.session.awaitingPassword = false;
  }
}

async function handleAdminTextAction(ctx) {
  const text = ctx.message.text;
  
  if (ctx.session.adminAction?.startsWith('add_task_step')) {
    const step = parseInt(ctx.session.adminAction.replace('add_task_step', ''));
    
    if (step === 1) {
      ctx.session.newTask = { title: text };
      ctx.session.adminAction = 'add_task_step2';
      await ctx.reply('📝 Enter a short description for the task:');
    } else if (step === 2) {
      ctx.session.newTask.description = text;
      ctx.session.adminAction = 'add_task_step3';
      await ctx.reply('🔗 Enter the task link (URL):');
    } else if (step === 3) {
      ctx.session.newTask.link = text;
      ctx.session.adminAction = 'add_task_step4';
      
    let taskType = 'other';
const text = ctx.message.text.toLowerCase();

// Detect Telegram
if (text.includes('t.me') || text.includes('telegram')) {
  taskType = 'telegram';
}
// Detect Twitter (including Click-to-Tweet links) - both twitter.com and x.com
else if (
  text.includes('twitter.com') || 
  text.includes('x.com/intent/tweet') ||
  text.includes('x.com/') ||
  text.includes('twitter.com/intent/tweet')
) {
  taskType = 'twitter';
}
      
      ctx.session.newTask.type = taskType;
      await ctx.reply(`💰 Enter the reward amount for this ${taskType} task:`);
    } else if (step === 4) {
      const reward = parseInt(text);
      if (isNaN(reward)) {
        await ctx.reply('❌ Please enter a valid number for the reward.');
        return;
      }
      
      ctx.session.newTask.reward = reward;
      const task = new Task({
        ...ctx.session.newTask,
        active: true
      });
      
      await task.save();
      delete ctx.session.newTask;
      delete ctx.session.adminAction;
      
      await ctx.replyWithHTML(
        '✅ <b>Task created successfully!</b>\n\n' +
        `<b>Title:</b> ${task.title}\n` +
        `<b>Description:</b> ${task.description}\n` +
        `<b>Link:</b> ${task.link}\n` +
        `<b>Reward:</b> ${task.reward} ${process.env.CURRENCY_NAME}\n` +
        `<b>Type:</b> ${task.type}`
      );
      
      await showAdminPanel(ctx);
    }
    return;
  }

  if (ctx.session.adminAction === 'editing_task' && ctx.session.editingTask) {
    const [title, description, link, reward, active] = text.split('|');
    
    await Task.findByIdAndUpdate(ctx.session.editingTask, {
      title: title.trim(),
      description: description.trim(),
      link: link.trim(),
      reward: parseInt(reward.trim()),
      active: active.trim().toLowerCase() === 'true'
    });
    
    delete ctx.session.editingTask;
    delete ctx.session.adminAction;
    await ctx.reply('✅ Task updated successfully!');
    await editTasks(ctx);
    return;
  }

  if (ctx.session.adminAction?.startsWith('update_')) {
    const settingType = ctx.session.adminAction.replace('update_', '');
    let envKey, successMessage;
    
    switch(settingType) {
      case 'currency':
        envKey = 'CURRENCY_NAME';
        successMessage = `✅ Currency name updated to: ${text}`;
        break;
      case 'min_withdraw':
        envKey = 'MIN_WITHDRAW';
        successMessage = `✅ Minimum withdrawal updated to: ${text}`;
        break;
      case 'referral_bonus':
        envKey = 'REFERRAL_BONUS';
        successMessage = `✅ Referral bonus updated to: ${text}`;
        break;
    }
    
    await updateEnvVariable(envKey, text);
    delete ctx.session.adminAction;
    await ctx.reply(successMessage);
    await showSettings(ctx);
    return;
  }

  if (ctx.session.adminAction === 'broadcast') {
    const users = await User.find();
    let successCount = 0;
    
    for (const user of users) {
      try {
        await ctx.telegram.sendMessage(user.telegramId, text, { parse_mode: 'HTML' });
        successCount++;
      } catch (err) {
        console.error(`Failed to send to ${user.telegramId}:`, err);
      }
    }
    
    await ctx.reply(`📢 Broadcast sent to ${successCount}/${users.length} users!`);
    delete ctx.session.adminAction;
  }
}

async function handleVerification(ctx) {
  const verificationType = ctx.match[1];
  ctx.session.verified[verificationType] = true;
  await ctx.answerCbQuery(`✅ ${verificationType.replace('_', ' ')} verified!`);
}

module.exports = {
  adminLogin,
  showAdminPanel,
  showUserStats,
  showBotStats,
  showSettings,
  showDepositInfo,
  refreshDepositInfo,
  backToSettings,
  addTask,
  editTasks,
  handleEditTask,
  handleDeleteTask,
  cancelAddTask,
  cancelEditTask,
  handleSettingUpdate,
  cancelSettingUpdate,
  updateEnvVariable,
  broadcastMessage,
  handleAdminPassword,
  handleAdminTextAction,
  handleVerification

};

