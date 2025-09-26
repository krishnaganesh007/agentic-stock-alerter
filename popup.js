class StockAlertExtension {
    constructor() {
      this.watchlist = {};
      this.apiKey = '';
      this.init();
    }
  
    async init() {
      await this.loadSettings();
      await this.loadWatchlist();
      this.setupEventListeners();
      this.renderWatchlist();
      this.startPeriodicCheck();
    }
  
    async loadSettings() {
      const result = await chrome.storage.sync.get(['apiKey', 'checkInterval', 'enableNotifications']);
      this.apiKey = result.apiKey || '';
      document.getElementById('apiKey').value = this.apiKey;
      document.getElementById('checkInterval').value = result.checkInterval || 30;
      document.getElementById('enableNotifications').checked = result.enableNotifications !== false;
    }
  
    async loadWatchlist() {
      const result = await chrome.storage.local.get(['watchlist']);
      this.watchlist = result.watchlist || {};
    }
  
    async saveWatchlist() {
      await chrome.storage.local.set({ watchlist: this.watchlist });
    }
  
    async saveSettings() {
      const settings = {
        apiKey: document.getElementById('apiKey').value,
        checkInterval: parseInt(document.getElementById('checkInterval').value),
        enableNotifications: document.getElementById('enableNotifications').checked
      };
      await chrome.storage.sync.set(settings);
      this.apiKey = settings.apiKey;
    }
  
    setupEventListeners() {
      document.getElementById('processInput').addEventListener('click', () => this.processNaturalInput());
      document.getElementById('refreshAll').addEventListener('click', () => this.refreshAllPrices());
      document.getElementById('apiKey').addEventListener('change', () => this.saveSettings());
      document.getElementById('checkInterval').addEventListener('change', () => this.saveSettings());
      document.getElementById('enableNotifications').addEventListener('change', () => this.saveSettings());
  
      // Enter key support for input
      document.getElementById('naturalInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.processNaturalInput();
        }
      });
    }
  
    async processNaturalInput() {
      const input = document.getElementById('naturalInput').value.trim();
      if (!input) return;
  
      if (!this.apiKey) {
        alert('Please enter your Gemini API key in settings first!');
        return;
      }
  
      const button = document.getElementById('processInput');
      const btnText = button.querySelector('.btn-text');
      const spinner = button.querySelector('.loading-spinner');
      
      button.disabled = true;
      btnText.style.display = 'none';
      spinner.style.display = 'inline';
  
      try {
        const result = await this.callGeminiAgent(input);
        if (result.success) {
          document.getElementById('naturalInput').value = '';
          await this.loadWatchlist();
          this.renderWatchlist();
          this.showNotification('✅ Stock added to watchlist successfully!');
        } else {
          this.showNotification('❌ ' + result.error);
        }
      } catch (error) {
        this.showNotification('❌ Error processing request: ' + error.message);
      } finally {
        button.disabled = false;
        btnText.style.display = 'inline';
        spinner.style.display = 'none';
      }
    }
  
    async callGeminiAgent(naturalInput) {
      // Enhanced system prompt for natural language understanding
      const systemPrompt = `You are StockAlertAgent. Parse natural language requests to add stocks to watchlist.
  
  Extract the following from user input:
  1. Stock symbols (convert company names to symbols)
  2. Threshold method preference (or use default "percentage" with 5%)
  
  Respond with EXACTLY ONE of these formats:
  1. FUNCTION_CALL: add_to_watchlist_with_suggestions|SYMBOL|method|percentage
  2. FUNCTION_CALL: add_to_watchlist|SYMBOL|low|high (if specific thresholds mentioned)
  3. FINAL_ANSWER: error_message (if cannot understand input)
  
  Examples:
  - "Watch AAPL stock" → FUNCTION_CALL: add_to_watchlist_with_suggestions|AAPL|percentage|5
  - "Add Google with 3% threshold" → FUNCTION_CALL: add_to_watchlist_with_suggestions|GOOGL|percentage|3
  - "Monitor Tesla" → FUNCTION_CALL: add_to_watchlist_with_suggestions|TSLA|percentage|5
  
  Common stock symbols: AAPL=Apple, GOOGL=Google, TSLA=Tesla, MSFT=Microsoft, AMZN=Amazon, META=Meta, NVDA=Nvidia`;
  
      try {
        const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=' + this.apiKey, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: `${systemPrompt}\n\nUser request: ${naturalInput}` }]
            }]
          })
        });
  
        const data = await response.json();
        const responseText = data.candidates[0].content.parts[0].text.trim();
  
        if (responseText.startsWith('FUNCTION_CALL:')) {
          const [, functionInfo] = responseText.split(':', 2);
          const parts = functionInfo.trim().split('|');
          const funcName = parts[0];
          const params = parts.slice(1);
  
          // Execute the function call
          const result = await this.executeFunctionCall(funcName, params);
          return { success: true, result };
        } else if (responseText.startsWith('FINAL_ANSWER:')) {
          const error = responseText.split(':', 1)[1].trim();
          return { success: false, error };
        } else {
          return { success: false, error: 'Could not understand the request. Please try rephrasing.' };
        }
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  
    async executeFunctionCall(funcName, params) {
      switch (funcName) {
        case 'add_to_watchlist_with_suggestions':
          const [symbol, method, percentage] = params;
          const suggestions = await this.suggestThresholds(symbol, method, parseInt(percentage) || 5);
          if (typeof suggestions === 'string') throw new Error(suggestions);
          
          this.watchlist[symbol.toUpperCase()] = {
            low: suggestions.low,
            high: suggestions.high,
            currentPrice: suggestions.current_price,
            method: suggestions.method,
            addedAt: new Date().toISOString()
          };
          await this.saveWatchlist();
          return `Added ${symbol} with suggested thresholds: $${suggestions.low} - $${suggestions.high}`;
  
        case 'add_to_watchlist':
          const [sym, low, high] = params;
          const currentPrice = await this.getStockPrice(sym);
          this.watchlist[sym.toUpperCase()] = {
            low: parseFloat(low),
            high: parseFloat(high),
            currentPrice: currentPrice,
            method: 'manual',
            addedAt: new Date().toISOString()
          };
          await this.saveWatchlist();
          return `Added ${sym} with manual thresholds: $${low} - $${high}`;
  
        default:
          throw new Error(`Unknown function: ${funcName}`);
      }
    }
  
    async getStockPrice(symbol) {
      try {
        const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`);
        const data = await response.json();
        const result = data.chart.result[0];
        const price = result.meta.regularMarketPrice;
        return Math.round(price * 100) / 100;
      } catch (error) {
        console.error('Error fetching stock price:', error);
        return null;
      }
    }
  
    async suggestThresholds(symbol, method = 'percentage', percentage = 5) {
      const currentPrice = await this.getStockPrice(symbol);
      if (!currentPrice) return `Could not fetch price for ${symbol}`;
  
      if (method === 'percentage') {
        const low = Math.round(currentPrice * (1 - percentage/100) * 100) / 100;
        const high = Math.round(currentPrice * (1 + percentage/100) * 100) / 100;
        
        return {
          symbol,
          current_price: currentPrice,
          method: `${percentage}% above/below current price`,
          low,
          high,
          reasoning: `Based on ${percentage}% movement from current price of $${currentPrice}`
        };
      }
      
      return `Method ${method} not implemented yet`;
    }
  
    renderWatchlist() {
      const container = document.getElementById('watchlistContainer');
      
      if (Object.keys(this.watchlist).length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <p>No stocks in watchlist yet</p>
            <p class="small-text">Add stocks using natural language above</p>
          </div>
        `;
        return;
      }
  
      container.innerHTML = Object.entries(this.watchlist).map(([symbol, data]) => `
        <div class="stock-item" data-symbol="${symbol}">
          <div class="stock-header">
            <span class="stock-symbol">${symbol}</span>
            <span class="stock-price ${this.getPriceClass(data.currentPrice, data.low, data.high)}">
              $${data.currentPrice || '---'}
              ${this.getStatusBadge(data.currentPrice, data.low, data.high)}
            </span>
          </div>
          <div class="threshold-controls">
            <input type="number" class="threshold-input" placeholder="Low" value="${data.low}" data-type="low">
            <input type="number" class="threshold-input" placeholder="High" value="${data.high}" data-type="high">
            <button class="update-btn" onclick="stockAlert.updateThresholds('${symbol}')">Update</button>
            <button class="remove-btn" onclick="stockAlert.removeStock('${symbol}')">Remove</button>
          </div>
        </div>
      `).join('');
    }
  
    getPriceClass(price, low, high) {
      if (!price) return 'price-neutral';
      if (price < low) return 'price-down';
      if (price > high) return 'price-down';
      return 'price-up';
    }
  
    getStatusBadge(price, low, high) {
      if (!price) return '<span class="status-indicator status-inactive"></span>';
      if (price < low || price > high) return '<span class="alert-badge">ALERT</span>';
      return '<span class="status-indicator status-active"></span>';
    }
  
    async updateThresholds(symbol) {
      const stockItem = document.querySelector(`[data-symbol="${symbol}"]`);
      const lowInput = stockItem.querySelector('[data-type="low"]');
      const highInput = stockItem.querySelector('[data-type="high"]');
      
      const newLow = parseFloat(lowInput.value);
      const newHigh = parseFloat(highInput.value);
      
      if (isNaN(newLow) || isNaN(newHigh) || newLow >= newHigh) {
        alert('Please enter valid threshold values (Low < High)');
        return;
      }
  
      this.watchlist[symbol].low = newLow;
      this.watchlist[symbol].high = newHigh;
      await this.saveWatchlist();
      
      this.showNotification(`✅ Updated thresholds for ${symbol}`);
    }
  
    async removeStock(symbol) {
      if (confirm(`Remove ${symbol} from watchlist?`)) {
        delete this.watchlist[symbol];
        await this.saveWatchlist();
        this.renderWatchlist();
        this.showNotification(`✅ Removed ${symbol} from watchlist`);
      }
    }
  
    async refreshAllPrices() {
      const symbols = Object.keys(this.watchlist);
      if (symbols.length === 0) return;
  
      for (const symbol of symbols) {
        const price = await this.getStockPrice(symbol);
        if (price) {
          this.watchlist[symbol].currentPrice = price;
        }
      }
      
      await this.saveWatchlist();
      this.renderWatchlist();
      this.checkAlerts();
    }
  
    checkAlerts() {
      const alerts = [];
      
      Object.entries(this.watchlist).forEach(([symbol, data]) => {
        const { currentPrice, low, high } = data;
        if (currentPrice && (currentPrice < low || currentPrice > high)) {
          const alertType = currentPrice < low ? 'BELOW' : 'ABOVE';
          alerts.push(`🚨 ${symbol}: $${currentPrice} is ${alertType} threshold range ($${low}-$${high})`);
        }
      });
  
      if (alerts.length > 0 && document.getElementById('enableNotifications').checked) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'assets/icon.png',
          title: 'StockAlertAgent Alert!',
          message: alerts[0], // Show first alert
          priority: 2
        });
      }
    }
  
    async startPeriodicCheck() {
      // Set up alarm for background checking
      const interval = parseInt(document.getElementById('checkInterval').value) || 30;
      chrome.alarms.clear('stockCheck');
      chrome.alarms.create('stockCheck', { periodInMinutes: interval });
    }
  
    showNotification(message) {
      // Simple in-popup notification
      const notification = document.createElement('div');
      notification.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        background: #333;
        color: white;
        padding: 8px 12px;
        border-radius: 4px;
        font-size: 12px;
        z-index: 1000;
      `;
      notification.textContent = message;
      document.body.appendChild(notification);
      
      setTimeout(() => notification.remove(), 3000);
    }
  }
  
  // Initialize the extension
  const stockAlert = new StockAlertExtension();
  