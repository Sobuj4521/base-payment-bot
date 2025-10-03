const { Markup } = require('telegraf');
const User = require('../models/User');
const { formatWithUSD } = require('../utils/helpers');

async function showReferral(ctx) {
  try {
    const referralLink = `https://t.me/${ctx.botInfo.username}?start=${ctx.user.telegramId}`;
    const completedCount = ctx.user.referrals.filter(ref => ref.completed).length;
    const pendingCount = ctx.user.referrals.filter(ref => !ref.completed).length;
    
    await ctx.replyWithHTML(
      `<b>📢 Referral Program</b>\n\n` +
      `Invite friends and earn <b>${formatWithUSD(parseInt(process.env.REFERRAL_BONUS))}</b> for each!\n\n` +
      `<b>Requirements:</b>\n` +
      `- Referred friend must complete at least 1 task\n` +
      `- Bonus credited only once per referral\n\n` +
      `<b>Your referral link:</b>\n<code>${referralLink}</code>\n\n` +
      `<b>Total referrals:</b> ${ctx.user.referrals.length}\n` +
      `<b>Pending completion:</b> ${pendingCount}\n` +
      `<b>Completed referrals:</b> ${completedCount}`,
      Markup.inlineKeyboard([
        Markup.button.callback('🔄 Refresh', 'refresh_referrals')
      ])
    );
  } catch (error) {
    console.error('Referral display error:', error);
    await ctx.reply('❌ Error loading referral information. Please try again.');
  }
}

async function checkReferralCompletion(ctx) {
  try {
    // Get the full user document for updates
    const user = await User.findById(ctx.user._id);
    if (!user) return;
    
    const referrals = await User.find({ 
      referredBy: user.telegramId,
      completedTasks: { $exists: true, $not: { $size: 0 } }
    });

    for (const referral of referrals) {
      const refIndex = user.referrals.findIndex(r => r.userId === referral.telegramId);
      
      if (refIndex === -1) {
        user.referrals.push({
          userId: referral.telegramId,
          username: referral.username,
          completed: true,
          claimed: true,
          completedAt: new Date(),
          referredAt: new Date()
        });
        
        user.balance += parseInt(process.env.REFERRAL_BONUS);
        await user.save();
        
        await ctx.reply(
          `🎉 Referral bonus earned!\n` +
          `User @${referral.username} completed their first task.\n` +
          `+${formatWithUSD(parseInt(process.env.REFERRAL_BONUS))} added to your balance!`
        );
      } else if (!user.referrals[refIndex].completed) {
        user.referrals[refIndex].completed = true;
        user.referrals[refIndex].claimed = true;
        user.referrals[refIndex].completedAt = new Date();
        user.balance += parseInt(process.env.REFERRAL_BONUS);
        
        await user.save();
        await ctx.reply(
          `🎉 Referral bonus earned!\n` +
          `User @${referral.username} completed their first task.\n` +
          `+${formatWithUSD(parseInt(process.env.REFERRAL_BONUS))} added to your balance!`
        );
      }
    }
  } catch (error) {
    console.error('Referral completion check error:', error);
  }
}

async function refreshReferral(ctx) {
  try {
    // Refresh completion status first
    await checkReferralCompletion(ctx);
    
    // Get updated user data
    const user = await User.findById(ctx.user._id);
    const referralLink = `https://t.me/${ctx.botInfo.username}?start=${user.telegramId}`;
    const completedCount = user.referrals.filter(ref => ref.completed).length;
    const pendingCount = user.referrals.filter(ref => !ref.completed).length;
    
    // Create the new message content
    const newMessageText = 
      `<b>📢 Referral Program</b>\n\n` +
      `Invite friends and earn <b>${formatWithUSD(parseInt(process.env.REFERRAL_BONUS))}</b> for each!\n\n` +
      `<b>Requirements:</b>\n` +
      `- Referred friend must complete at least 1 task\n` +
      `- Bonus credited only once per referral\n\n` +
      `<b>Your referral link:</b>\n<code>${referralLink}</code>\n\n` +
      `<b>Total referrals:</b> ${user.referrals.length}\n` +
      `<b>Pending completion:</b> ${pendingCount}\n` +
      `<b>Completed referrals:</b> ${completedCount}`;
    
    // Get current message text to compare
    const currentMessageText = ctx.update.callback_query.message.text;
    
    // Only edit if the content has actually changed
    if (currentMessageText !== newMessageText) {
      await ctx.editMessageText(newMessageText, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Refresh', callback_data: 'refresh_referrals' }]
          ]
        }
      });
    } else {
      // If content is the same, just answer the callback without editing
      await ctx.answerCbQuery('✅ Already up to date!');
    }
    
    return true;
  } catch (error) {
    if (error.response && error.response.description.includes('message is not modified')) {
      // This is expected - content hasn't changed
      await ctx.answerCbQuery('✅ Already up to date!');
      return true;
    }
    console.error('Referral refresh error:', error);
    throw error;
  }
}

module.exports = { showReferral, checkReferralCompletion, refreshReferral };