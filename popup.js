class StockAlertExtension {
  constructor() {
    this.watchlist = {};
    this.apiKey = '';
    this.logs = [];
    this.currentIteration = 0;
    this.init();
  }

  async init() {
    await this.loadSettings();
    await this.loadWatchlist();
    await this.loadLogs();
    this.setupEventListeners();
    this.renderWatchlist();
    this.renderLogs();
    this.startPeriodicCheck();
  }

  async loadLogs() {
    const result = await chrome.storage.local.get(['agentLogs']);
    this.logs = result.agentLogs || [];
  }

  async saveLogs() {
    await chrome.storage.local.set({ agentLogs: this.logs });
  }

  setupEventListeners() {
    // Existing event listeners...
    document.getElementById('processInput').addEventListener('click', () => this.processNaturalInput());
    document.getElementById('refreshAll').addEventListener('click', () => this.refreshAllPrices());
    document.getElementById('apiKey').addEventListener('change', () => this.saveSettings());
    document.getElementById('checkInterval').addEventListener('change', () => this.saveSettings());
    document.getElementById('enableNotifications').addEventListener('change', () => this.saveSettings());

    // New log controls
    document.getElementById('toggleLogs').addEventListener('click', () => this.toggleLogs());
    document.getElementById('clearLogs').addEventListener('click', () => this.clearLogs());

    // Enter key support for input
    document.getElementById('naturalInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.processNaturalInput();
      }
    });
  }

  toggleLogs() {
    const container = document.getElementById('logsContainer');
    const isVisible = container.style.display !== 'none';
    container.style.display = isVisible ? 'none' : 'block';
    
    if (!isVisible) {
      this.renderLogs();
    }
  }

  async clearLogs() {
    if (confirm('Clear all agent logs?')) {
      this.logs = [];
      await this.saveLogs();
      this.renderLogs();
    }
  }

  addLog(type, content, iteration = null) {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = {
      timestamp,
      iteration: iteration || this.currentIteration,
      type,
      content
    };
    
    this.logs.push(logEntry);
    this.saveLogs(); // Save logs persistently
    
    // Auto-scroll logs if visible
    setTimeout(() => {
      const logsContent = document.getElementById('logsContent');
      if (logsContent) {
        logsContent.scrollTop = logsContent.scrollHeight;
      }
    }, 100);
  }

  renderLogs() {
    const container = document.getElementById('logsContent');
    
    if (this.logs.length === 0) {
      container.innerHTML = '<div class="empty-logs">No logs yet. Add a stock to see agent activity.</div>';
      return;
    }

    // Group logs by iteration
    const logsByIteration = {};
    this.logs.forEach(log => {
      if (!logsByIteration[log.iteration]) {
        logsByIteration[log.iteration] = [];
      }
      logsByIteration[log.iteration].push(log);
    });

    container.innerHTML = Object.entries(logsByIteration)
      .sort(([a], [b]) => parseInt(b) - parseInt(a)) // Newest first
      .slice(0, 10) // Show last 10 sessions
      .map(([iteration, logs]) => `
        <div class="log-entry">
          <div class="log-header">
            <span class="log-iteration">--- Session ${iteration} ---</span>
            <span class="log-timestamp">${logs[0].timestamp}</span>
          </div>
          ${logs.map(log => `
            <div class="log-step">
              <div class="log-${log.type}">${this.formatLogContent(log.type, log.content)}</div>
            </div>
          `).join('')}
        </div>
      `).join('');
  }

  formatLogContent(type, content) {
    switch (type) {
      case 'input':
        return `📝 User Input: "${content}"`;
      case 'llm-response':
        return `🧠 LLM Response: ${content}`;
      case 'function-call':
        return `🔧 Calling: ${content.funcName}(${JSON.stringify(content.params)})`;
      case 'result':
        return `✅ Result: ${content}`;
      case 'error':
        return `❌ Error: ${content}`;
      case 'final':
        return `🎯 Final Answer: ${content}`;
      default:
        return content;
    }
  }

  async processNaturalInput() {
    const input = document.getElementById('naturalInput').value.trim();
    console.log('Input:', input); // Debug
    console.log('API Key:', this.apiKey); // Debug
    console.log('API Key length:', this.apiKey?.length); // Debug
    
    if (!input) return;
  
    // More detailed API key check
    if (!this.apiKey || this.apiKey.trim() === '') {
      console.log('API key missing or empty'); // Debug
      alert('Please enter your Gemini API key in settings first!');
      return;
    }

    // Start new iteration
    this.currentIteration = Date.now(); // Use timestamp as unique iteration ID
    this.addLog('input', input);

    const button = document.getElementById('processInput');
    const btnText = button.querySelector('.btn-text');
    const spinner = button.querySelector('.loading-spinner');
    
    button.disabled = true;
    btnText.style.display = 'none';
    spinner.style.display = 'inline';

    try {
      const result = await this.callGeminiAgentWithLogs(input);
      if (result.success) {
        document.getElementById('naturalInput').value = '';
        await this.loadWatchlist();
        this.renderWatchlist();
        this.addLog('final', 'Stock added to watchlist successfully!');
        this.showNotification('✅ Stock added to watchlist successfully!');
      } else {
        this.addLog('error', result.error);
        this.showNotification('❌ ' + result.error);
      }
    } catch (error) {
      this.addLog('error', 'Error processing request: ' + error.message);
      this.showNotification('❌ Error processing request: ' + error.message);
    } finally {
      button.disabled = false;
      btnText.style.display = 'inline';
      spinner.style.display = 'none';
      this.renderLogs();
    }
  }

  async callGeminiAgentWithLogs(naturalInput) {
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
      
      // Check if response is valid
      if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
        this.addLog('error', 'Invalid response from Gemini API');
        return { success: false, error: 'Invalid response from Gemini API' };
      }
      
      const responseText = data.candidates[0].content.parts[0].text.trim();
      this.addLog('llm-response', responseText);

      // Handle multi-line responses - extract just the function call
      let functionCallLine = responseText;
      if (responseText.includes('\n')) {
        const lines = responseText.split('\n');
        for (const line of lines) {
          if (line.trim().startsWith('FUNCTION_CALL:')) {
            functionCallLine = line.trim();
            break;
          }
        }
      }

      if (functionCallLine.startsWith('FUNCTION_CALL:')) {
        // Use the same parsing logic from your Python agent
        const [, functionInfo] = functionCallLine.split(':', 2);
        
        if (!functionInfo) {
          this.addLog('error', 'Invalid function call format');
          return { success: false, error: 'Invalid function call format' };
        }

        const functionInfoTrimmed = functionInfo.trim();
        
        // Parse function call
        if (functionInfoTrimmed.includes('|')) {
          const parts = functionInfoTrimmed.split('|');
          const funcName = parts[0].trim();
          const params = parts.slice(1).map(p => p.trim()).filter(p => p.length > 0);
          
          this.addLog('function-call', { funcName, params });
          
          // Execute the function call
          const result = await this.executeFunctionCallWithLogs(funcName, params);
          this.addLog('result', result);
          return { success: true, result };
        } else {
          // No parameters
          const funcName = functionInfoTrimmed.trim();
          this.addLog('function-call', { funcName, params: [] });
          const result = await this.executeFunctionCallWithLogs(funcName, []);
          this.addLog('result', result);
          return { success: true, result };
        }
      } else if (functionCallLine.startsWith('FINAL_ANSWER:')) {
        const error = functionCallLine.split(':', 2)[1]?.trim() || 'Unknown error';
        this.addLog('error', error);
        return { success: false, error };
      } else {
        const error = 'Could not understand the request. Please try rephrasing.';
        this.addLog('error', error);
        return { success: false, error };
      }
    } catch (error) {
      this.addLog('error', error.message);
      return { success: false, error: error.message };
    }
  }

  async executeFunctionCallWithLogs(funcName, params) {
    try {
      switch (funcName) {
        case 'add_to_watchlist_with_suggestions':
          if (params.length < 1) {
            throw new Error('Missing required parameter: symbol');
          }
          
          const [symbol, method = 'percentage', percentage = '5'] = params;
          const suggestions = await this.suggestThresholds(symbol, method, parseInt(percentage) || 5);
          
          if (typeof suggestions === 'string') {
            throw new Error(suggestions);
          }
          
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
          if (params.length < 3) {
            throw new Error('Missing required parameters: symbol, low, high');
          }
          
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
    } catch (error) {
      throw error;
    }
  }

  // ... rest of your existing methods stay the same
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