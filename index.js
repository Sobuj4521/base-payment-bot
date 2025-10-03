require('dotenv').config();
const { Telegraf, Markup, session } = require('telegraf');
const mongoose = require('mongoose');
const Task = require('./models/Task');
const User = require('./models/User');
const Withdrawal = require('./models/Withdrawal');

// Follow me @MetaCoderJack
const startHandler = require('./handlers/startHandler');
const taskHandler = require('./handlers/taskHandler');
const profileHandler = require('./handlers/profileHandler');
const referralHandler = require('./handlers/referralHandler');
const { handleWithdraw, confirmWithdraw, cancelWithdraw, isValidBaseAddress } = require('./handlers/withdrawHandler');
const historyHandler = require('./handlers/historyHandler');
const admin = require('./admin/admin');
const { verifyCaptcha } = require('./utils/captcha');
const { formatWithUSD } = require('./utils/helpers');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Follow me @MetaCoderJack
let adminIds = [];
let cachedTasks = [];
if (process.env.ADMIN_IDS) {
  adminIds = process.env.ADMIN_IDS.split(',').map(id => id.trim());
}

// Follow me @MetaCoderJack
const userCache = new Map();

// Follow me @MetaCoderJack
bot.use(session({
  defaultSession: () => ({
    verified: {
      channel_1: false,
      channel_2: false,
      group: false
    },
    profileStep: null,
    referralId: null,
    isAdmin: false,
    captchaSolved: false,
    awaitingPassword: false,
    currentTask: null,
    verificationStep: null,
    twitterProof: null,
    adminAction: null,
    editingTask: null,
    newTask: null,
    verificationData: null,
    lastActivity: Date.now()
  })
}));

// Follow me @MetaCoderJack
async function cacheTasks() {
  try {
    cachedTasks = await Task.find({ active: true }).lean();
    console.log(`✅ Cached ${cachedTasks.length} active tasks`);
    
    // Follow me @MetaCoderJack
    for (const [key, value] of userCache.entries()) {
      if (key.startsWith('user_')) {
        try {
          const freshUser = await User.findById(value.data._id).lean();
          if (freshUser) {
            userCache.set(key, {
              data: freshUser,
              timestamp: Date.now()
            });
          }
        } catch (error) {
          console.error('Error refreshing user cache:', error);
        }
      }
    }
  } catch (error) {
    console.error('❌ Task caching error:', error);
  }
}

// Early expiration check middleware
bot.use(async (ctx, next) => {
  if (ctx.callbackQuery) {
    const queryDate = ctx.callbackQuery._receivedAt || (ctx.callbackQuery.message && ctx.callbackQuery.message.date * 1000) || Date.now();
    const queryAge = Date.now() - queryDate;
    
    // Reject queries older than 60 seconds (Telegram's timeout is around 30-60s)
    if (queryAge > 60000) {
      try {
        await ctx.answerCbQuery('⌛ This action expired. Please try again.', { show_alert: false });
      } catch (error) {
        // Silent fail for expired queries
      }
      return; // Stop further processing
    }
  }
  await next();
});

// Follow me @MetaCoderJack
bot.on('callback_query', async (ctx, next) => {
  try {
    // Add timestamp to track query age
    ctx.callbackQuery._receivedAt = Date.now();
    
    await next();
  } catch (error) {
    // Handle specific Telegram timeout errors silently
    if (error.message.includes('query is too old') || 
        error.message.includes('response timeout expired') ||
        error.message.includes('query ID is invalid')) {
      
      console.log('⚠️ Callback query expired:', error.message);
      
      // Try to answer with a user-friendly message if possible
      try {
        await ctx.answerCbQuery('⌛ This action expired. Please try again.', { show_alert: false });
      } catch (innerError) {
        // Silent fail for already expired queries
      }
      return;
    }
    
    console.error('Callback query error:', error);
    
    // General error handling
    try {
      await ctx.answerCbQuery('❌ An error occurred. Please try again.', { show_alert: true });
    } catch (innerError) {
      console.error('Failed to send error message:', innerError);
    }
  }
});

// Optimized by metacoderjack
bot.use(async (ctx, next) => {
  try {
    if (ctx.from) {
      const userId = ctx.from.id.toString();
      const cacheKey = `user_${userId}`;
      
      // Check cache first with freshness validation
      if (userCache.has(cacheKey)) {
        const cachedUser = userCache.get(cacheKey);
        const cacheAge = Date.now() - cachedUser.timestamp;
        
        // Follow me @MetaCoderJack
        if (cacheAge < 30000 || ctx.callbackQuery) {
          ctx.user = cachedUser.data;
          // Follow me @MetaCoderJack
          ctx.user.lastActivity = Date.now();
          return await next();
        }
      }
      
      // Check if MongoDB is connected
      if (mongoose.connection.readyState !== 1) {
        console.log('⚠️ MongoDB not connected yet, using temporary user object');
        ctx.user = {
          telegramId: ctx.from.id,
          username: ctx.from.username,
          firstName: ctx.from.first_name,
          lastName: ctx.from.last_name,
          telegramUsername: ctx.from.username ? `@${ctx.from.username}` : undefined,
          profileCompleted: false,
          balance: 0,
          referrals: [],
          completedTasks: []
        };
        return await next();
      }
      
      //Follow me @MetaCoderJack
      ctx.user = await User.findOneAndUpdate(
        { telegramId: ctx.from.id },
        { 
          $set: {
            lastActive: new Date(),
            telegramUsername: ctx.from.username ? `@${ctx.from.username}` : undefined
          }
        },
        { 
          upsert: true, 
          new: true, 
          lean: true,
          projection: {
            telegramId: 1,
            username: 1,
            firstName: 1,
            lastName: 1,
            telegramUsername: 1,
            twitterUsername: 1,
            walletAddress: 1,
            balance: 1,
            referrals: 1,
            completedTasks: 1,
            profileCompleted: 1,
            referredBy: 1
          }
        }
      );
      
      // Ensure completedTasks exists
      if (!ctx.user.completedTasks) {
        ctx.user.completedTasks = [];
      }
      
      // Update cache
      userCache.set(cacheKey, {
        data: ctx.user,
        timestamp: Date.now()
      });
      
      if (ctx.user.profileCompleted) {
        ctx.session.captchaSolved = true;
      }
      
      // Check referrals in background without blocking
      setImmediate(() => {
        referralHandler.checkReferralCompletion(ctx).catch(err => {
          console.error('Referral check error:', err);
        });
      });
    }
    await next();
  } catch (error) {
    console.error('User middleware error:', error);
    await next();
  }
});

// Cache cleanup
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of userCache.entries()) {
    if (now - value.timestamp > 30000) {
      userCache.delete(key);
    }
  }
}, 60000);

// Session cleanup for inactive sessions
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of Object.entries(bot.context.sessions || {})) {
    if (now - (session.lastActivity || 0) > 3600000) { // 1 hour
      delete bot.context.sessions[key];
    }
  }
}, 600000); // Run every 10 minutes

// Commands with error handling - OPTIMIZED
const commandHandlers = {
  'start': startHandler.handleStart,
  'admin_login': async (ctx) => {
    try {
      if (adminIds.includes(ctx.from.id.toString())) {
        if (ctx.session.isAdmin) {
          await admin.showAdminPanel(ctx);
        } else {
          ctx.session.awaitingPassword = true;
          await ctx.reply('🔐 Please enter admin password:');
        }
      } else {
        await ctx.reply('❌ Unauthorized access');
      }
    } catch (error) {
      console.error('Admin login error:', error);
      await ctx.reply('❌ Error processing admin login.');
    }
  }
};

// Register commands with proper error checking
Object.entries(commandHandlers).forEach(([command, handler]) => {
  if (typeof handler === 'function') {
    bot.command(command, handler);
  } else {
    console.error(`❌ Handler for command /${command} is undefined`);
  }
});

// Menu handlers with error handling - OPTIMIZED
const menuHandlers = {
  '💰 Balance': async (ctx) => {
    try {
      const lastWithdrawal = await Withdrawal.findOne({ userId: ctx.user._id }).sort({ createdAt: -1 }).lean();
      await ctx.replyWithHTML(
        `<b>💰 Your Balance:</b> ${formatWithUSD(ctx.user.balance)}\n\n` +
        `<b>📅 Last Withdrawal:</b> ${lastWithdrawal ? 
          `${formatWithUSD(lastWithdrawal.amount)} (${lastWithdrawal.status})` : 
          'None'}`
      );
    } catch (error) {
      console.error('Balance error:', error);
      await ctx.reply('❌ Error retrieving balance information.');
    }
  },
  '👤 Profile': async (ctx) => {
    try {
      await profileHandler.showProfile(ctx);
    } catch (error) {
      console.error('Profile error:', error);
      await ctx.reply('❌ Error loading profile.');
    }
  },
  '📢 Referral': async (ctx) => {
    try {
      await referralHandler.showReferral(ctx);
    } catch (error) {
      console.error('Referral error:', error);
      await ctx.reply('❌ Error loading referral information.');
    }
  },
  '💸 Withdraw': async (ctx) => {
    try {
      await handleWithdraw(ctx);
    } catch (error) {
      console.error('Withdraw error:', error);
      await ctx.reply('❌ Error processing withdrawal.');
    }
  },
  '📋 Tasks': async (ctx) => {
    try {
      // Use cached tasks for faster response
      if (cachedTasks.length > 0) {
        await taskHandler.showTasks(ctx, cachedTasks);
      } else {
        await taskHandler.showTasks(ctx);
      }
    } catch (error) {
      console.error('Tasks error:', error);
      await ctx.reply('❌ Error loading tasks.');
    }
  },
  '📜 History': async (ctx) => {
    try {
      await historyHandler.showHistory(ctx);
    } catch (error) {
      console.error('History error:', error);
      await ctx.reply('❌ Error loading history.');
    }
  }
};

// Register menu handlers
Object.entries(menuHandlers).forEach(([text, handler]) => {
  bot.hears(text, handler);
});

async function completeTaskWithCache(ctx) {
  try {
    // Call the original completeTask function
    await taskHandler.completeTask(ctx);
    
    // Update the user cache after task completion
    const cacheKey = `user_${ctx.user.telegramId}`;
    const updatedUser = await User.findOne({ telegramId: ctx.user.telegramId }).lean();
    
    if (updatedUser) {
      userCache.set(cacheKey, {
        data: updatedUser,
        timestamp: Date.now()
      });
      
      // Also update ctx.user for the current session
      ctx.user.balance = updatedUser.balance;
      ctx.user.completedTasks = updatedUser.completedTasks;
    }
  } catch (error) {
    console.error('Complete task with cache error:', error);
    throw error;
  }
}

// Admin panel handlers with error handling
const adminHandlers = {
  '👥 User Stats': admin.showUserStats,
  '📊 Bot Stats': admin.showBotStats,
  '➕ Add Task': admin.addTask,
  '✏️ Edit Tasks': admin.editTasks,
  '⚙️ Settings': admin.showSettings,
  '📤 Broadcast': admin.broadcastMessage,
  '🏠 Main Menu': startHandler.showMainMenu
};

Object.entries(adminHandlers).forEach(([text, handler]) => {
  bot.hears(text, async (ctx) => {
    try {
      if (ctx.session.isAdmin) {
        await handler(ctx);
      } else {
        await ctx.reply('❌ Admin access required');
      }
    } catch (error) {
      console.error(`Admin handler ${text} error:`, error);
      await ctx.reply('❌ Error processing admin command.');
    }
  });
});

// Wrap all action handlers with timeout protection
const createActionHandler = (handler) => {
  return async (ctx) => {
    try {
      // Check if this is a potentially expired query
      if (ctx.callbackQuery) {
        const queryDate = ctx.callbackQuery._receivedAt || (ctx.callbackQuery.message && ctx.callbackQuery.message.date * 1000) || Date.now();
        const queryAge = Date.now() - queryDate;
        if (queryAge > 55000) { // Slightly less than our 60s cutoff
          await ctx.answerCbQuery('⌛ Action timed out. Please try again.', { show_alert: false });
          return;
        }
      }
      
      await handler(ctx);
    } catch (error) {
      if (error.message.includes('query is too old') || 
          error.message.includes('response timeout expired') ||
          error.message.includes('query ID is invalid')) {
        // Already handled by global middleware, just log
        console.log('Expired query in action handler:', error.message);
        return;
      }
      throw error; // Re-throw for global handler
    }
  };
};

// Action handlers - OPTIMIZED
const actionHandlers = {
  'show_settings': admin.showSettings,
  'refresh_deposit_info': admin.refreshDepositInfo,
  'back_to_settings': admin.backToSettings,
  'verify_telegram_membership': async (ctx) => {
    try {
      if (!ctx.session.verificationData || !ctx.session.verificationData.chatId || !ctx.session.verificationData.taskId) {
        return await ctx.answerCbQuery('❌ No active verification process');
      }

      const { chatId, taskId } = ctx.session.verificationData;
      const task = await Task.findById(taskId).lean();
      
      if (!task) {
        return await ctx.answerCbQuery('❌ Task not found');
      }

      const chatMember = await ctx.telegram.getChatMember(chatId, ctx.from.id);
      
      if (!['member', 'administrator', 'creator'].includes(chatMember.status)) {
        return await ctx.answerCbQuery('❌ You still need to join the channel/group');
      }

      ctx.session.currentTask = taskId;
      await completeTaskWithCache(ctx); // Use the wrapper function instead
      delete ctx.session.verificationData;
      
    } catch (error) {
      console.error('Telegram verification error:', error);
      await ctx.answerCbQuery('❌ Verification failed. Please try again later.');
    }
  },
  'confirm_withdraw': confirmWithdraw,
  'cancel_withdraw': cancelWithdraw,
  'edit_profile': async (ctx) => {
    try {
      ctx.session.profileStep = 'telegram';
      await ctx.replyWithHTML(
        '📝 <b>Edit Profile</b>\n\n' +
        'Please enter your Telegram username (with @):\n' +
        '<i>Example: @username</i>'
      );
    } catch (error) {
      console.error('Edit profile error:', error);
      await ctx.reply('❌ Error starting profile edit.');
    }
  },
  'refresh_referrals': async (ctx) => {
    try {
      await ctx.answerCbQuery('🔄 Refreshing...');
      await referralHandler.refreshReferral(ctx);
    } catch (error) {
      console.error('Refresh referrals error:', error);
      try {
        await ctx.answerCbQuery('❌ Failed to refresh referrals');
      } catch (error) {
        await ctx.reply('❌ Failed to refresh referrals');
      }
    }
  },
  'cancel_edit_task': async (ctx) => {
    try {
      delete ctx.session.editingTask;
      delete ctx.session.adminAction;
      await ctx.deleteMessage();
      await ctx.reply('❌ Task editing canceled.');
    } catch (error) {
      console.error('Cancel edit task error:', error);
    }
  },
  'cancel_add_task': async (ctx) => {
    try {
      delete ctx.session.newTask;
      delete ctx.session.adminAction;
      await ctx.deleteMessage();
      await ctx.reply('❌ Task creation canceled.');
      await admin.showAdminPanel(ctx);
    } catch (error) {
      console.error('Cancel add task error:', error);
    }
  },
  'cancel_setting_update': async (ctx) => {
    try {
      delete ctx.session.adminAction;
      await ctx.deleteMessage();
      await ctx.reply('❌ Setting update canceled.');
    } catch (error) {
      console.error('Cancel setting update error:', error);
    }
  },
  'continue_after_verify': async (ctx) => {
    try {
      const requiredVerifications = ['channel_1', 'channel_2', 'group'];
      const allVerified = requiredVerifications.every(v => ctx.session.verified[v]);
      
      if (!allVerified) {
        await ctx.answerCbQuery('⚠️ Please complete all verification steps first!');
        return;
      }
      
      // Answer the callback first to prevent timeout
      await ctx.answerCbQuery('✅ Verification complete!');
      
      // Try to delete the message, but handle the case where it might not exist
      try {
        await ctx.deleteMessage();
      } catch (deleteError) {
        // If the message is already deleted or not found, just continue
        if (!deleteError.response || !deleteError.response.description.includes('message to delete not found')) {
          console.error('Error deleting verification message:', deleteError);
        }
        // Continue with the flow regardless of delete success
      }
      
      await startHandler.collectUserData(ctx);
    } catch (error) {
      console.error('Continue after verify error:', error);
      try {
        await ctx.answerCbQuery('❌ Error continuing verification.');
      } catch (answerError) {
        console.error('Failed to answer callback query:', answerError);
      }
    }
  }
};

// Register action handlers with timeout protection
Object.entries(actionHandlers).forEach(([action, handler]) => {
  bot.action(action, createActionHandler(handler));
});

// Task verification handlers with improved error handling
bot.action(/verify_task_(.+)/, async (ctx) => {
  try {
    // Immediate response to prevent timeout
    await ctx.answerCbQuery('🔄 Processing...', { show_alert: false });
    
    await taskHandler.handleTaskVerification(ctx);
  } catch (error) {
    console.error('Task verification error:', error);
    
    if (error.message.includes('query is too old')) {
      try {
        await ctx.answerCbQuery('⌛ Verification timed out. Please try the task again.', { show_alert: true });
      } catch (e) {
        // Already expired, can't respond
      }
    } else {
      try {
        await ctx.answerCbQuery('❌ Task verification failed. Please try again.', { show_alert: true });
      } catch (e) {
        // Fallback to message if callback answer fails
        await ctx.reply('❌ Task verification failed. Please try again.');
      }
    }
  }
});

// Admin callback handlers
bot.action(/edit_task_(.+)/, async (ctx) => {
  try {
    if (ctx.session.isAdmin) {
      await admin.handleEditTask(ctx, ctx.match[1]);
    }
  } catch (error) {
    console.error('Edit task error:', error);
    await ctx.answerCbQuery('❌ Error editing task.');
  }
});

bot.action(/delete_task_(.+)/, async (ctx) => {
  try {
    if (ctx.session.isAdmin) {
      await admin.handleDeleteTask(ctx, ctx.match[1]);
    }
  } catch (error) {
    console.error('Delete task error:', error);
    await ctx.answerCbQuery('❌ Error deleting task.');
  }
});

bot.action(/verify_(channel_1|channel_2|group)/, async (ctx) => {
  try {
    const verificationType = ctx.match[1];
    ctx.session.verified[verificationType] = true;
    await ctx.answerCbQuery(`✅ ${verificationType.replace('_', ' ')} verified!`);
  } catch (error) {
    if (!error.message.includes('query is too old')) {
      console.error('Verification error:', error);
    }
  }
});

// Admin setting handlers
const settingHandlers = {
  'set_currency': 'currency',
  'set_min_withdraw': 'min_withdraw',
  'set_referral_bonus': 'referral_bonus'
};

Object.entries(settingHandlers).forEach(([action, settingType]) => {
  bot.action(action, async (ctx) => {
    try {
      if (ctx.session.isAdmin) {
        await admin.handleSettingUpdate(ctx, settingType);
      }
    } catch (error) {
      console.error(`Setting ${settingType} error:`, error);
      await ctx.answerCbQuery('❌ Error updating setting.');
    }
  });
});

// Photo handler for task proof with error handling
bot.on('photo', async (ctx) => {
  try {
    if (ctx.session.verificationStep === 'screenshot' || ctx.session.verificationStep === 'twitter_screenshot') {
      const task = await Task.findById(ctx.session.currentTask).lean();
      if (task) {
        // Use the wrapper function that handles cache updates
        await completeTaskWithCache(ctx);
        
        // Clear session
        delete ctx.session.currentTask;
        delete ctx.session.verificationStep;
        delete ctx.session.twitterProof;
        
        // Check if this user was referred by someone
        if (ctx.user.referredBy) {
          const referrer = await User.findOne({ telegramId: ctx.user.referredBy }).lean();
          if (referrer) {
            // Update referrer's referral status
            const referralIndex = referrer.referrals.findIndex(r => 
              r.userId.toString() === ctx.user.telegramId.toString()
            );
            
            if (referralIndex !== -1 && !referrer.referrals[referralIndex].completed) {
              const referralBonus = parseInt(process.env.REFERRAL_BONUS) || 10;
              
              await User.findByIdAndUpdate(
                referrer._id,
                {
                  $set: {
                    [`referrals.${referralIndex}.completed`]: true,
                    [`referrals.${referralIndex}.completedAt`]: new Date(),
                    [`referrals.${referralIndex}.claimed`]: true
                  },
                  $inc: { balance: referralBonus }
                }
              );
              
              // Notify referrer in background
              setImmediate(async () => {
                try {
                  await ctx.telegram.sendMessage(
                    referrer.telegramId,
                    `🎉 Referral bonus earned!\n` +
                    `User @${ctx.user.username} completed their first task.\n` +
                    `+${formatWithUSD(referralBonus)} added to your balance!`
                  );
                } catch (notificationError) {
                  console.error('Failed to notify referrer:', notificationError);
                }
              });
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('Photo handler error:', error);
    await ctx.reply('❌ Error processing your task proof. Please try again.');
  }
});

// Text handler with comprehensive error handling - OPTIMIZED
bot.on('text', async (ctx) => {
  try {
    // Admin password handling
    if (ctx.session.awaitingPassword) {
      if (ctx.message.text === process.env.ADMIN_PASSWORD) {
        ctx.session.isAdmin = true;
        ctx.session.awaitingPassword = false;
        await admin.showAdminPanel(ctx);
      } else {
        await ctx.reply('❌ Incorrect password. Try /admin_login again.');
        ctx.session.awaitingPassword = false;
      }
      return;
    }

    // CAPTCHA handling
    if (ctx.session.captchaAnswer && !ctx.session.captchaSolved) {
      const isCorrect = verifyCaptcha(ctx.message.text, ctx.session.captchaAnswer);
      if (isCorrect) {
        ctx.session.captchaSolved = true;
        await ctx.reply('✅ CAPTCHA solved correctly!');
        await startHandler.showVerificationTasks(ctx);
      } else {
        await ctx.reply('❌ Incorrect answer. Please try again.');
      }
      return;
    }

    // Twitter username submission
    if (ctx.session.verificationStep === 'twitter_username') {
      const twitterUsername = ctx.message.text.trim();
      if (twitterUsername.includes('@')) {
        await ctx.reply('⚠️ Please enter your Twitter username without @');
        return;
      }
      
      ctx.session.twitterProof = twitterUsername;
      ctx.session.verificationStep = 'twitter_screenshot';
      await ctx.reply('📸 Please submit a screenshot showing you completed the Twitter task:');
      return;
    }

    // Profile data collection - Base wallet address
    if (ctx.session.profileStep === 'wallet') {
      const walletAddress = ctx.message.text.trim();
      
      // Use Base wallet validation
      if (!isValidBaseAddress(walletAddress)) {
        return await ctx.reply(
          '⚠️ Please enter a valid Base wallet address:\n' +
          '• Should start with 0x\n' +
          '• Should be exactly 42 characters long\n' +
          '• Should be a valid Ethereum-style address\n' +
          '• Example: 0x742d35Cc6634C893292Ce8bB6239C002Ad8e6b59'
        );
      }
      
      ctx.user.walletAddress = walletAddress;
      ctx.user.profileCompleted = true;
      
      // Handle referral if exists
      if (ctx.session.referralId) {
        const referrer = await User.findOne({ telegramId: ctx.session.referralId }).lean();
        if (referrer) {
          // Add to referrer's referral list
          await User.findByIdAndUpdate(
            referrer._id,
            {
              $push: {
                referrals: {
                  userId: ctx.user.telegramId,
                  username: ctx.user.username,
                  completed: false,
                  claimed: false,
                  referredAt: new Date()
                }
              }
            }
          );
          
          // Set referredBy for the current user
          ctx.user.referredBy = ctx.session.referralId;
          
          await ctx.reply(`🎉 You were referred by ${referrer.username || referrer.firstName}!`);
        }
      }
      
      await User.findByIdAndUpdate(ctx.user._id, {
        walletAddress: walletAddress,
        profileCompleted: true,
        referredBy: ctx.user.referredBy
      });
      
      delete ctx.session.profileStep;
      delete ctx.session.referralId;
      
      await ctx.reply('✅ Profile data saved successfully!');
      return await startHandler.showMainMenu(ctx);
    }

    // Other profile steps
    if (ctx.session.profileStep) {
      try {
        await profileHandler.handleProfileUpdate(ctx);
      } catch (error) {
        console.error('Profile update error:', error);
        await ctx.reply('❌ Error processing your profile data. Please try again.');
      }
      return;
    }

    // Admin task creation step-by-step
    if (ctx.session.adminAction?.startsWith('add_task_step')) {
      const step = parseInt(ctx.session.adminAction.replace('add_task_step', ''));
      
      if (step === 1) {
        ctx.session.newTask = { title: ctx.message.text };
        ctx.session.adminAction = 'add_task_step2';
        await ctx.reply('📝 Enter a short description for the task:');
      } 
      else if (step === 2) {
        ctx.session.newTask.description = ctx.message.text;
        ctx.session.adminAction = 'add_task_step3';
        await ctx.reply(
          '🔗 Enter the task link (URL):',
          Markup.inlineKeyboard([
            Markup.button.callback('❌ Cancel', 'cancel_add_task')
          ])
        );
      }
      else if (step === 3) {
        ctx.session.newTask.link = ctx.message.text;
        ctx.session.adminAction = 'add_task_step4';
        
        // Auto-detect task type based on link with improved detection
        let taskType = 'other';
        const text = ctx.message.text.toLowerCase();

        try {
          const url = new URL(text);
          const hostname = url.hostname;
          
          // PRIMARY DETECTION: Check the actual domain only (ignore URL parameters)
          if (hostname.includes('t.me') || hostname === 'telegram.org') {
            taskType = 'telegram';
          }
          else if (hostname.includes('twitter.com') || hostname.includes('x.com')) {
            taskType = 'twitter';
          }
          // SECONDARY DETECTION: If domain is generic, check for specific patterns in path
          else {
            // Check for Twitter intent patterns in the path (not in query parameters)
            if (url.pathname.includes('/intent/') || url.pathname.includes('/tweet')) {
              taskType = 'twitter';
            }
            // Check for other platform-specific patterns
            else if (url.pathname.includes('/telegram') || url.pathname.includes('/tg')) {
              taskType = 'telegram';
            }
          }
        } catch (error) {
          // Fallback: Use very specific pattern matching that ignores encoded URLs
          // Only look for patterns at the beginning of the URL (domain level)
          const cleanText = text.replace(/https?:\/\//, '');
          
          if (cleanText.startsWith('t.me/') || cleanText.startsWith('telegram.')) {
            taskType = 'telegram';
          }
          else if (cleanText.startsWith('twitter.com/') || cleanText.startsWith('x.com/')) {
            taskType = 'twitter';
          }
          // Look for intent patterns that are NOT encoded (very specific)
          else if (text.includes('x.com/intent/') || text.includes('twitter.com/intent/')) {
            taskType = 'twitter';
          }
        }
        
        ctx.session.newTask.type = taskType;
        
        await ctx.reply(
          `🔄 Detected task type: ${taskType}\n\n` +
          '💰 Enter the reward amount:',
          Markup.inlineKeyboard([
            Markup.button.callback('❌ Cancel', 'cancel_add_task')
          ])
        );
      }
      else if (step === 4) {
        const reward = parseInt(ctx.message.text);
        if (isNaN(reward)) {
          await ctx.reply('❌ Please enter a valid number for the reward.');
          return;
        }
        
        ctx.session.newTask.reward = reward;
        
        // Create the task
        const task = new Task({
          title: ctx.session.newTask.title,
          description: ctx.session.newTask.description,
          link: ctx.session.newTask.link,
          reward: ctx.session.newTask.reward,
          type: ctx.session.newTask.type,
          active: true
        });
        
        await task.save();
        
        // Update cache
        cachedTasks = await Task.find({ active: true }).lean();
        
        delete ctx.session.newTask;
        delete ctx.session.adminAction;
        
        await ctx.replyWithHTML(
          '✅ <b>Task created successfully!</b>\n\n' +
          `<b>Title:</b> ${task.title}\n` +
          `<b>Description:</b> ${task.description}\n` +
          `<b>Link:</b> ${task.link}\n` +
          `<b>Reward:</b> ${formatWithUSD(task.reward)}\n` +
          `<b>Type:</b> ${task.type}`
        );
        
        await admin.showAdminPanel(ctx);
      }
      return;
    }

    // Task editing
    if (ctx.session.adminAction === 'editing_task' && ctx.session.editingTask) {
      const [title, description, link, reward, active] = ctx.message.text.split('|');
      
      await Task.findByIdAndUpdate(ctx.session.editingTask, {
        title: title.trim(),
        description: description.trim(),
        link: link.trim(),
        reward: parseInt(reward.trim()),
        active: active.trim().toLowerCase() === 'true'
      });
      
      // Update cache
        cachedTasks = await Task.find({ active: true }).lean();
      
      delete ctx.session.editingTask;
      delete ctx.session.adminAction;
      await ctx.reply('✅ Task updated successfully!');
      await admin.editTasks(ctx);
      return;
    }

    // Setting updates
    if (ctx.session.adminAction?.startsWith('update_')) {
      const settingType = ctx.session.adminAction.replace('update_', '');
      let envKey, successMessage;
      
      switch(settingType) {
        case 'currency':
          envKey = 'CURRENCY_NAME';
          successMessage = `✅ Currency name updated to: ${ctx.message.text}`;
          break;
        case 'min_withdraw':
          envKey = 'MIN_WITHDRAW';
          successMessage = `✅ Minimum withdrawal updated to: ${ctx.message.text}`;
          break;
        case 'referral_bonus':
          envKey = 'REFERRAL_BONUS';
          successMessage = `✅ Referral bonus updated to: ${ctx.message.text}`;
          break;
      }
      
      await admin.updateEnvVariable(envKey, ctx.message.text);
      delete ctx.session.adminAction;
      await ctx.reply(successMessage);
      await admin.showSettings(ctx);
      return;
    }

    // Admin broadcast
    if (ctx.session.adminAction === 'broadcast') {
      const users = await User.find({}, 'telegramId').lean();
      let successCount = 0;
      
      // Process in batches for better performance
      const batchSize = 30;
      for (let i = 0; i < users.length; i += batchSize) {
        const batch = users.slice(i, i + batchSize);
        const promises = batch.map(user => 
          bot.telegram.sendMessage(user.telegramId, ctx.message.text, { parse_mode: 'HTML' })
            .then(() => true)
            .catch(err => {
              console.error(`Failed to send to ${user.telegramId}:`, err);
              return false;
            })
        );
        
        const results = await Promise.all(promises);
        successCount += results.filter(Boolean).length;
        
        // Small delay between batches to avoid rate limiting
        if (i + batchSize < users.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      await ctx.reply(`📢 Broadcast sent to ${successCount}/${users.length} users!`);
      delete ctx.session.adminAction;
      return;
    }
  } catch (error) {
    console.error('Text handler error:', error);
    await ctx.reply('❌ Error processing your message. Please try again.');
  }
});

// Enhanced error handler with better logging
bot.catch((err, ctx) => {
  const errorInfo = {
    error: err.message,
    stack: err.stack,
    updateType: ctx.updateType,
    userId: ctx.from?.id,
    chatId: ctx.chat?.id,
    timestamp: new Date().toISOString()
  };
  
  console.error('⚠️ Bot error:', errorInfo);
  
  try {
    if (ctx.updateType === 'message' || ctx.updateType === 'callback_query') {
      ctx.reply('❌ An error occurred. Please try again later.');
    }
  } catch (replyError) {
    console.error('Failed to send error message:', replyError);
  }
  
  // Optional: Send critical errors to admin
  if (err.message.includes('query is too old')) {
    // Don't alert admins for common timeout errors
    return;
  }
  
  // Alert admins for other critical errors
  adminIds.forEach(adminId => {
    bot.telegram.sendMessage(adminId, `🚨 Bot error: ${err.message}`).catch(console.error);
  });
});

// Connect to MongoDB with modern settings
async function connectToMongoDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      minPoolSize: 5,
      bufferCommands: false
    });
    console.log('✅ Connected to MongoDB');
    
    // Only start caching tasks after successful connection
    await cacheTasks();
    setInterval(cacheTasks, 5 * 60 * 1000);
  } catch (err) {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  }
}

// Start the bot with better error handling
async function startBot() {
  try {
    // First connect to MongoDB
    await connectToMongoDB();
    
    // Then start the bot
    await bot.launch();
    console.log('🤖 Bot started successfully');
  } catch (err) {
    console.error('❌ Bot failed to start:', err);
    process.exit(1);
  }
}

// Start the application
startBot();

// Enable graceful stop
process.once('SIGINT', () => {
  console.log('🛑 Stopping bot (SIGINT)');
  bot.stop('SIGINT');
  process.exit();
});

process.once('SIGTERM', () => {
  console.log('🛑 Stopping bot (SIGTERM)');
  bot.stop('SIGTERM');
  process.exit();
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});