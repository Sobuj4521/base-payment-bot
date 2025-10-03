// Follow me @MetaCoderJack
const { Markup } = require('telegraf');
const { sendBaseTokens, isValidBaseAddress, BASE_EXPLORER, quickBalanceCheck, getBaseBalances } = require('../utils/base'); // FIXED IMPORT PATH
const Withdrawal = require('../models/Withdrawal');
const User = require('../models/User');
const { formatWithUSD } = require('../utils/helpers');

// Track pending withdrawals to prevent race conditions
const pendingWithdrawals = new Map();

async function handleWithdraw(ctx) {
  try {
    const user = ctx.user;
    const userId = user._id.toString();
    const currencyName = process.env.CURRENCY_NAME || '0XL';
    
    // Check if user already has a pending withdrawal
    if (pendingWithdrawals.has(userId)) {
      return ctx.replyWithHTML(
        '⏳ <b>Withdrawal Already in Progress</b>\n\n' +
        'You already have a withdrawal request being processed.\n' +
        'Please wait for it to complete before initiating another one.'
      );
    }
    
    // Validate wallet address
    if (!user.walletAddress) {
      return ctx.replyWithHTML(
        '❌ <b>No Wallet Address Set</b>\n\n' +
        'You need to set a Base wallet address first to withdraw.\n' +
        'Use /profile to set your address.'
      );
    }

    if (!isValidBaseAddress(user.walletAddress)) {
      return ctx.replyWithHTML(
        '❌ <b>Invalid Base Wallet Address</b>\n\n' +
        'The address you provided is not valid. Please check:\n' +
        '1. It should be a valid Ethereum-style address (0x...)\n' +
        '2. It should be 42 characters long\n' +
        '3. No special characters except letters and numbers\n\n' +
        'Current address: <code>' + user.walletAddress + '</code>\n\n' +
        'Use /profile to update your wallet address'
      );
    }

    const minWithdraw = parseFloat(process.env.MIN_WITHDRAW) || 50;
    if (user.balance < minWithdraw) {
      return ctx.replyWithHTML(
        `❌ <b>Minimum Withdrawal Not Met</b>\n\n` +
        `Minimum withdrawal amount: ${formatWithUSD(minWithdraw)}\n` +
        `Your current balance: ${formatWithUSD(user.balance)}\n\n` +
        `Keep earning to reach the minimum!`
      );
    }

    // Check token balance with improved error handling
    let availableBalance = 0;
    try {
      // First try quick check
      const quickBalance = await quickBalanceCheck();
      availableBalance = parseFloat(quickBalance);
      
      // If quick check fails or shows 0, try full check
      if (availableBalance === 0 || isNaN(availableBalance)) {
        const balances = await getBaseBalances();
        if (balances.status === 'error') {
          console.error('Balance check error:', balances.error);
          availableBalance = 0;
        } else {
          availableBalance = parseFloat(balances.tokenBalance);
        }
      }
    } catch (balanceError) {
      console.error('Balance check failed:', balanceError);
      availableBalance = 0;
    }

    const requiredAmount = user.balance;

    if (availableBalance < requiredAmount) {
      return ctx.replyWithHTML(
        `⚠️ <b>Temporary Withdrawal Limit</b>\n\n` +
        `Our payout wallet currently has limited funds:\n` +
        `Available: ${formatWithUSD(availableBalance)}\n` +
        `Your withdrawal: ${formatWithUSD(requiredAmount)}\n\n` +
        `Please try again later or contact support.`
      );
    }

    // Mark this user as having a pending withdrawal
    pendingWithdrawals.set(userId, {
      amount: user.balance,
      address: user.walletAddress,
      timestamp: Date.now()
    });

    // Confirmation message
    await ctx.replyWithHTML(
      `💸 <b>Withdrawal Confirmation</b>\n\n` +
      `Amount: ${formatWithUSD(user.balance)}\n` +
      `Recipient: <code>${user.walletAddress.trim()}</code>\n` +
      `Network: Base Mainnet\n\n` +
      `Please confirm this transaction:`,
      Markup.inlineKeyboard([
        [Markup.button.callback('✅ Confirm Withdrawal', 'confirm_withdraw')],
        [Markup.button.callback('❌ Cancel', 'cancel_withdraw')]
      ])
    );

  } catch (err) {
    console.error('Withdrawal initiation error:', err);
    await ctx.replyWithHTML(
      '❌ <b>System Error</b>\n\n' +
      'We encountered an issue processing your request.\n' +
      'Our team has been notified. Please try again later.'
    );
  }
}

async function confirmWithdraw(ctx) {
  const user = ctx.user;
  const userId = user._id.toString();
  const currencyName = process.env.CURRENCY_NAME || 'doginme';
  
  try {
    await ctx.editMessageText('🔄 Processing your withdrawal... Please wait...');

    // Check if this is a valid pending withdrawal
    if (!pendingWithdrawals.has(userId)) {
      throw new Error('No pending withdrawal found or it has expired');
    }

    const pendingWithdrawal = pendingWithdrawals.get(userId);
    
    // Re-check wallet balance right before processing with better error handling
    let availableBalance = 0;
    try {
      // Use quick check first
      const quickBalance = await quickBalanceCheck();
      availableBalance = parseFloat(quickBalance);
      
      // If quick check fails, try full check
      if (availableBalance === 0 || isNaN(availableBalance)) {
        const balances = await getBaseBalances();
        if (balances.status === 'error') {
          throw new Error(`Could not verify wallet balance: ${balances.error}`);
        }
        availableBalance = parseFloat(balances.tokenBalance);
      }
    } catch (balanceError) {
      throw new Error(`Balance verification failed: ${balanceError.message}`);
    }

    if (availableBalance < pendingWithdrawal.amount) {
      // Remove from pending withdrawals
      pendingWithdrawals.delete(userId);
      
      await ctx.editMessageText(
        `⚠️ <b>Temporary Withdrawal Limit</b>\n\n` +
        `Our payout wallet currently has limited funds:\n` +
        `Available: ${formatWithUSD(availableBalance)}\n` +
        `Your withdrawal: ${formatWithUSD(pendingWithdrawal.amount)}\n\n` +
        `Please try again later or contact support.`
      );
      return;
    }

    // Store the withdrawal amount before resetting balance
    const withdrawalAmount = pendingWithdrawal.amount;

    // Send tokens with better error handling
    const result = await sendBaseTokens(user.walletAddress.trim(), withdrawalAmount);
    
    if (!result.success) {
      // Check for specific error types
      if (result.error && result.error.includes('Insufficient')) {
        throw new Error('Insufficient funds in payout wallet. Please try again later.');
      } else if (result.error && result.error.includes('revert')) {
        throw new Error('Token transfer failed. Please contact support.');
      } else if (result.error && result.error.includes('gas')) {
        throw new Error('Transaction failed due to gas issues. Please contact support.');
      } else {
        throw new Error(result.error || 'Transaction failed without error message');
      }
    }

    if (!result.txHash) {
      throw new Error('Transaction completed but no transaction hash received');
    }

    // Save withdrawal record
    const withdrawal = await new Withdrawal({
      userId: user._id,
      amount: withdrawalAmount,
      walletAddress: user.walletAddress.trim(),
      status: 'completed',
      txHash: result.txHash,
      networkFee: 0.001, // Estimated ETH gas fee
      currency: currencyName,
      processedAt: new Date()
    }).save();

    // Update user balance - use atomic operation to prevent race conditions
    await User.findByIdAndUpdate(
      user._id, 
      { 
        $inc: { balance: -withdrawalAmount },
        lastWithdrawal: new Date()
      }
    );

    // Remove from pending withdrawals
    pendingWithdrawals.delete(userId);

    await ctx.replyWithHTML(
      `✅ <b>Withdrawal Successful!</b>\n\n` +
      `Amount: ${formatWithUSD(withdrawalAmount)}\n` +
      `Network: Base Mainnet\n` +
      `TX Hash: <code>${result.txHash}</code>\n\n` +
      `View on explorer: <a href="${result.explorerUrl}">BaseScan</a>`
    );
    
  } catch (err) {
    console.error('Withdrawal failed:', err);
    
    // Remove from pending withdrawals on failure
    pendingWithdrawals.delete(userId);

    await new Withdrawal({
      userId: user._id,
      amount: user.balance,
      walletAddress: user.walletAddress.trim(),
      status: 'failed',
      error: err.message,
      currency: currencyName,
      attemptedAt: new Date()
    }).save();

    await ctx.editMessageText(
      `❌ <b>Withdrawal Failed</b>\n\n` +
      `Error: ${err.message}\n\n` +
      `Your balance remains unchanged. Please try again later or contact support if this persists.`
    );
  }
}

async function cancelWithdraw(ctx) {
  const userId = ctx.user._id.toString();
  pendingWithdrawals.delete(userId);
  await ctx.editMessageText('❌ Withdrawal cancelled.');
}

// Clean up expired pending withdrawals (older than 30 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [userId, withdrawal] of pendingWithdrawals.entries()) {
    if (now - withdrawal.timestamp > 30 * 60 * 1000) { // 30 minutes
      pendingWithdrawals.delete(userId);
      console.log(`Cleaned up expired withdrawal for user ${userId}`);
    }
  }
}, 10 * 60 * 1000); // Check every 10 minutes

module.exports = {
  handleWithdraw,
  confirmWithdraw,
  cancelWithdraw,
  isValidBaseAddress,
  pendingWithdrawals
};
