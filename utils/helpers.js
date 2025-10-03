function formatWithUSD(amount) {
  const tokenPrice = parseFloat(process.env.TOKEN_PRICE) || 0.1;
  const usdValue = (amount * tokenPrice).toFixed(2);
  return `${amount} ${process.env.CURRENCY_NAME || 'TOKENS'} ($${usdValue} USD)`;
}

function detectTaskType(link) {
  let taskType = 'other';
  const text = link.toLowerCase();

  try {
    const url = new URL(text);
    const hostname = url.hostname;
    
    if (hostname.includes('t.me') || hostname === 'telegram.org') {
      taskType = 'telegram';
    } else if (hostname.includes('twitter.com') || hostname.includes('x.com')) {
      taskType = 'twitter';
    } else {
      if (url.pathname.includes('/intent/') || url.pathname.includes('/tweet')) {
        taskType = 'twitter';
      } else if (url.pathname.includes('/telegram') || url.pathname.includes('/tg')) {
        taskType = 'telegram';
      }
    }
  } catch (error) {
    const cleanText = text.replace(/https?:\/\//, '');
    if (cleanText.startsWith('t.me/') || cleanText.startsWith('telegram.')) {
      taskType = 'telegram';
    } else if (cleanText.startsWith('twitter.com/') || cleanText.startsWith('x.com/')) {
      taskType = 'twitter';
    } else if (text.includes('x.com/intent/') || text.includes('twitter.com/intent/')) {
      taskType = 'twitter';
    }
  }
  
  return taskType;
}

module.exports = { formatWithUSD, detectTaskType };