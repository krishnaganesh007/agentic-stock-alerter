// Background service worker for Chrome extension
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'stockCheck') {
      await checkAllStocks();
    }
  });
  
  async function checkAllStocks() {
    const { watchlist } = await chrome.storage.local.get(['watchlist']);
    const { enableNotifications } = await chrome.storage.sync.get(['enableNotifications']);
    
    if (!watchlist || Object.keys(watchlist).length === 0) return;
  
    const alerts = [];
    
    for (const [symbol, data] of Object.entries(watchlist)) {
      try {
        const price = await getStockPrice(symbol);
        if (price && (price < data.low || price > data.high)) {
          const alertType = price < data.low ? 'BELOW' : 'ABOVE';
          alerts.push(`${symbol}: $${price} is ${alertType} range ($${data.low}-$${data.high})`);
          
          // Update stored price
          watchlist[symbol].currentPrice = price;
        }
      } catch (error) {
        console.error(`Error checking ${symbol}:`, error);
      }
    }
  
    // Save updated prices
    await chrome.storage.local.set({ watchlist });
  
    // Show notifications if enabled and there are alerts
    if (enableNotifications && alerts.length > 0) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'assets/icon.png',
        title: `StockAlertAgent - ${alerts.length} Alert${alerts.length > 1 ? 's' : ''}`,
        message: alerts[0] + (alerts.length > 1 ? `\n+${alerts.length - 1} more alerts` : ''),
        priority: 2
      });
    }
  }
  
  async function getStockPrice(symbol) {
    try {
      const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`);
      const data = await response.json();
      const price = data.chart.result[0].meta.regularMarketPrice;
      return Math.round(price * 100) / 100;
    } catch (error) {
      console.error('Error fetching stock price:', error);
      return null;
    }
  }
  
  // Handle installation
  chrome.runtime.onInstalled.addListener(() => {
    console.log('StockAlertAgent installed');
  });
  