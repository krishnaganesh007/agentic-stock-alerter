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
    
    // Auto-scroll logs if visible and render immediately
    setTimeout(() => {
      this.renderLogs();
      const logsContent = document.getElementById('logsContent');
      if (logsContent && document.getElementById('logsContainer').style.display !== 'none') {
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
          ${logs.map((log, index) => `
            <div class="log-step">
              <div class="step-number">Step ${index + 1}:</div>
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
    console.log('Input:', input);
    console.log('API Key:', this.apiKey);
    console.log('API Key length:', this.apiKey?.length);
    
    if (!input) return;

    if (!this.apiKey || this.apiKey.trim() === '') {
      console.log('API key missing or empty');
      alert('Please enter your Gemini API key in settings first!');
      return;
    }

    // Start new iteration
    this.currentIteration = Date.now();
    this.addLog('input', input);

    const button = document.getElementById('processInput');
    const btnText = button.querySelector('.btn-text');
    const spinner = button.querySelector('.loading-spinner');
    
    button.disabled = true;
    btnText.style.display = 'none';
    spinner.style.display = 'inline';

    try {
      let maxSteps = 10; // Prevent infinite loops
      let stepCount = 0;
      
      while (stepCount < maxSteps) {
        stepCount++;
        console.log(`Processing step ${stepCount}`);
        
        const result = await this.callGeminiAgentWithLogs(input);
        
        if (result.success === true) {
          // Task completed successfully
          document.getElementById('naturalInput').value = '';
          await this.loadWatchlist();
          this.renderWatchlist();
          this.addLog('final', 'Multi-step task completed successfully!');
          this.showNotification('✅ Task completed successfully!');
          break;
        } else if (result.success === 'continue') {
          // Continue to next step
          continue;
        } else {
          // Error occurred
          this.addLog('error', result.error);
          this.showNotification('❌ ' + result.error);
          break;
        }
      }
      
      if (stepCount >= maxSteps) {
        this.addLog('error', 'Maximum steps reached. Task may be incomplete.');
        this.showNotification('⚠️ Task took too many steps. Check results.');
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
    // Enhanced system prompt for step-by-step processing
    const systemPrompt = `You are StockAlertAgent. Process user requests step-by-step using multiple function calls.
  
  Available functions (use multiple functions for each task):
  1. lookup_stock_symbol(company_name) - Convert company name to stock symbol
  2. get_stock_price(symbol) - Get current stock price
  3. suggest_threshold_percentage(symbol) - Get suggested percentage for stock volatility
  4. calculate_thresholds(price|percentage) - Calculate low/high thresholds from price and percentage
  5. validate_thresholds(current_price|low|high) - Validate threshold values
  6. add_to_watchlist(symbol|low|high) - Add stock to watchlist with specific thresholds
  
  IMPORTANT: ALWAYS break down tasks into multiple steps. For ANY request to monitor/watch/add a stock:
  
  Step 1: ALWAYS start with lookup_stock_symbol if user mentions company name
  Step 2: ALWAYS get current price with get_stock_price
  Step 3: ALWAYS suggest threshold percentage (or use 5% if user specified)
  Step 4: ALWAYS calculate thresholds
  Step 5: ALWAYS add to watchlist
  
  Examples:
  User: "watch nvidia" → Start with: FUNCTION_CALL: lookup_stock_symbol|nvidia
  User: "add apple" → Start with: FUNCTION_CALL: lookup_stock_symbol|apple  
  User: "monitor tesla with 3%" → Start with: FUNCTION_CALL: lookup_stock_symbol|tesla
  User: "AAPL stock" → Start with: FUNCTION_CALL: get_stock_price|AAPL (already a symbol)
  
  Keywords that mean "add to watchlist": watch, monitor, add, track, alert
  
  Respond with EXACTLY ONE function call at a time in format:
  FUNCTION_CALL: function_name|param1|param2
  
  Never respond with "I don't understand" - ALWAYS start with lookup_stock_symbol for company names.`;
  
    try {
      // Build context from previous iterations
      let contextPrompt = `${systemPrompt}\n\nUser request: ${naturalInput}`;
      
      // Add previous function call results as context
      const currentSessionLogs = this.logs.filter(log => log.iteration === this.currentIteration);
      if (currentSessionLogs.length > 1) {
        const previousSteps = currentSessionLogs
          .filter(log => ['function-call', 'result'].includes(log.type))
          .map((log, index) => {
            if (log.type === 'function-call') {
              return `Previous step: Called ${log.content.funcName}(${JSON.stringify(log.content.params)})`;
            } else if (log.type === 'result') {
              return `Result: ${log.content}`;
            }
          })
          .filter(step => step) // Remove undefined entries
          .join('\n');
        
        contextPrompt += `\n\nPrevious steps completed:\n${previousSteps}\n\nWhat should I do next? Continue with the multi-step process.`;
      }
  
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=' + this.apiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: contextPrompt }]
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
          
          // Check if we need to continue with more steps
          return { success: 'continue', result };
        } else {
          const funcName = functionInfoTrimmed.trim();
          this.addLog('function-call', { funcName, params: [] });
          const result = await this.executeFunctionCallWithLogs(funcName, []);
          this.addLog('result', result);
          return { success: 'continue', result };
        }
      } else if (functionCallLine.startsWith('FINAL_ANSWER:')) {
        const finalAnswer = functionCallLine.split(':', 2)[1]?.trim() || 'Task completed';
        this.addLog('final', finalAnswer);
        return { success: true, result: finalAnswer };
      } else {
        // If no FUNCTION_CALL found, force a lookup as fallback
        this.addLog('error', `Unexpected response: ${responseText}. Forcing symbol lookup as fallback.`);
        
        // Extract company name from natural input
        const companyName = naturalInput.replace(/watch|monitor|add|track|alert|stock|with.*%/gi, '').trim();
        if (companyName) {
          this.addLog('function-call', { funcName: 'lookup_stock_symbol', params: [companyName] });
          const result = await this.executeFunctionCallWithLogs('lookup_stock_symbol', [companyName]);
          this.addLog('result', result);
          return { success: 'continue', result };
        }
        
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
        case 'lookup_stock_symbol':
          if (params.length < 1) {
            throw new Error('Missing required parameter: company_name');
          }
          const [companyName] = params;
          const lookupSymbol = await this.lookupStockSymbol(companyName);
          if (!lookupSymbol) {
            throw new Error(`Could not find stock symbol for "${companyName}"`);
          }
          return `Found stock symbol for ${companyName}: ${lookupSymbol}`;

        case 'get_stock_price':
          if (params.length < 1) {
            throw new Error('Missing required parameter: symbol');
          }
          const [priceSymbol] = params;
          const stockPrice = await this.getStockPrice(priceSymbol);
          if (!stockPrice) {
            throw new Error(`Could not fetch price for ${priceSymbol}`);
          }
          return `Current price of ${priceSymbol}: $${stockPrice}`;

        case 'calculate_thresholds':
          if (params.length < 2) {
            throw new Error('Missing required parameters: price, percentage');
          }
          const [inputPrice, inputPercentage] = params;
          const priceNum = parseFloat(inputPrice);
          const percentNum = parseFloat(inputPercentage);
          
          const calcLow = Math.round(priceNum * (1 - percentNum/100) * 100) / 100;
          const calcHigh = Math.round(priceNum * (1 + percentNum/100) * 100) / 100;
          
          return `Calculated thresholds: Low=$${calcLow}, High=$${calcHigh} (${percentNum}% of $${priceNum})`;

        case 'suggest_threshold_percentage':
          if (params.length < 1) {
            throw new Error('Missing required parameter: symbol');
          }
          const [suggestionSymbol] = params;
          // Default suggestion based on stock volatility (simplified)
          const suggestions = {
            'AAPL': 3,
            'GOOGL': 4,
            'TSLA': 6,
            'META': 5,
            'MSFT': 3,
            'AMZN': 4,
            'NVDA': 7,
            'INOD': 8
          };
          const suggestedPercentage = suggestions[suggestionSymbol.toUpperCase()] || 5;
          return `Suggested threshold percentage for ${suggestionSymbol}: ${suggestedPercentage}% (based on historical volatility)`;

        case 'validate_thresholds':
          if (params.length < 3) {
            throw new Error('Missing required parameters: current_price, low, high');
          }
          const [currentPriceStr, validationLowStr, validationHighStr] = params;
          const currentPrice = parseFloat(currentPriceStr);
          const validationLow = parseFloat(validationLowStr);
          const validationHigh = parseFloat(validationHighStr);
          
          if (validationLow >= validationHigh) {
            return `Invalid thresholds: Low ($${validationLow}) must be less than High ($${validationHigh})`;
          }
          if (currentPrice < validationLow || currentPrice > validationHigh) {
            return `Warning: Current price ($${currentPrice}) is outside threshold range ($${validationLow} - $${validationHigh})`;
          }
          return `Thresholds validated: Current price ($${currentPrice}) is within range ($${validationLow} - $${validationHigh})`;

        case 'add_to_watchlist':
          if (params.length < 3) {
            throw new Error('Missing required parameters: symbol, low, high');
          }
          const [watchlistSymbol, watchlistLow, watchlistHigh] = params;
          const watchlistPrice = await this.getStockPrice(watchlistSymbol);
          
          this.watchlist[watchlistSymbol.toUpperCase()] = {
            low: parseFloat(watchlistLow),
            high: parseFloat(watchlistHigh),
            currentPrice: watchlistPrice,
            method: 'multi-step calculated',
            addedAt: new Date().toISOString()
          };
          
          await this.saveWatchlist();
          return `Successfully added ${watchlistSymbol} to watchlist with thresholds: Low=$${watchlistLow}, High=$${watchlistHigh}`;

        default:
          throw new Error(`Unknown function: ${funcName}`);
      }
    } catch (error) {
      throw error;
    }
  }

  async lookupStockSymbol(companyName) {
    try {
      // Method 1: Try direct Yahoo Finance search
      const searchQuery = encodeURIComponent(companyName);
      const searchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${searchQuery}&quotes_count=5&news_count=0`;
      
      const response = await fetch(searchUrl);
      const data = await response.json();
      
      if (data.quotes && data.quotes.length > 0) {
        // Return the first match symbol
        const foundSymbol = data.quotes[0].symbol;
        console.log(`Found symbol for "${companyName}": ${foundSymbol}`);
        return foundSymbol;
      }
      
      // Method 2: Fallback - try some common patterns
      const commonMappings = {
        'apple': 'AAPL',
        'google': 'GOOGL',
        'microsoft': 'MSFT',
        'amazon': 'AMZN',
        'tesla': 'TSLA',
        'meta': 'META',
        'facebook': 'META',
        'nvidia': 'NVDA',
        'innodata': 'INOD',
        'netflix': 'NFLX',
        'walmart': 'WMT',
        'coca cola': 'KO',
        'johnson & johnson': 'JNJ',
        'jp morgan': 'JPM',
        'visa': 'V',
        'mastercard': 'MA'
      };
      
      const normalizedName = companyName.toLowerCase().trim();
      if (commonMappings[normalizedName]) {
        return commonMappings[normalizedName];
      }
      
      return null;
    } catch (error) {
      console.error('Error looking up stock symbol:', error);
      return null;
    }
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

  async getStockPrice(stockSymbol) {
    try {
      const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${stockSymbol}`);
      const data = await response.json();
      const result = data.chart.result[0];
      const price = result.meta.regularMarketPrice;
      return Math.round(price * 100) / 100;
    } catch (error) {
      console.error('Error fetching stock price:', error);
      return null;
    }
  }

  async suggestThresholds(stockSymbol, method = 'percentage', percentage = 5) {
    const currentPrice = await this.getStockPrice(stockSymbol);
    if (!currentPrice) return `Could not fetch price for ${stockSymbol}`;

    if (method === 'percentage') {
      const suggestedLow = Math.round(currentPrice * (1 - percentage/100) * 100) / 100;
      const suggestedHigh = Math.round(currentPrice * (1 + percentage/100) * 100) / 100;
      
      return {
        symbol: stockSymbol,
        current_price: currentPrice,
        method: `${percentage}% above/below current price`,
        low: suggestedLow,
        high: suggestedHigh,
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

    container.innerHTML = Object.entries(this.watchlist).map(([tickerSymbol, data]) => `
      <div class="stock-item" data-symbol="${tickerSymbol}">
        <div class="stock-header">
          <span class="stock-symbol">${tickerSymbol}</span>
          <span class="stock-price ${this.getPriceClass(data.currentPrice, data.low, data.high)}">
            $${data.currentPrice || '---'}
            ${this.getStatusBadge(data.currentPrice, data.low, data.high)}
          </span>
        </div>
        <div class="threshold-controls">
          <input type="number" class="threshold-input" placeholder="Low" value="${data.low}" data-type="low">
          <input type="number" class="threshold-input" placeholder="High" value="${data.high}" data-type="high">
          <button class="update-btn" onclick="stockAlert.updateThresholds('${tickerSymbol}')">Update</button>
          <button class="remove-btn" onclick="stockAlert.removeStock('${tickerSymbol}')">Remove</button>
        </div>
      </div>
    `).join('');
  }

  getPriceClass(price, thresholdLow, thresholdHigh) {
    if (!price) return 'price-neutral';
    if (price < thresholdLow) return 'price-down';
    if (price > thresholdHigh) return 'price-down';
    return 'price-up';
  }

  getStatusBadge(price, thresholdLow, thresholdHigh) {
    if (!price) return '<span class="status-indicator status-inactive"></span>';
    if (price < thresholdLow || price > thresholdHigh) return '<span class="alert-badge">ALERT</span>';
    return '<span class="status-indicator status-active"></span>';
  }

  async updateThresholds(tickerSymbol) {
    const stockItem = document.querySelector(`[data-symbol="${tickerSymbol}"]`);
    const lowInput = stockItem.querySelector('[data-type="low"]');
    const highInput = stockItem.querySelector('[data-type="high"]');
    
    const newLow = parseFloat(lowInput.value);
    const newHigh = parseFloat(highInput.value);
    
    if (isNaN(newLow) || isNaN(newHigh) || newLow >= newHigh) {
      alert('Please enter valid threshold values (Low < High)');
      return;
    }

    this.watchlist[tickerSymbol].low = newLow;
    this.watchlist[tickerSymbol].high = newHigh;
    await this.saveWatchlist();
    
    this.showNotification(`✅ Updated thresholds for ${tickerSymbol}`);
  }

  async removeStock(tickerSymbol) {
    if (confirm(`Remove ${tickerSymbol} from watchlist?`)) {
      delete this.watchlist[tickerSymbol];
      await this.saveWatchlist();
      this.renderWatchlist();
      this.showNotification(`✅ Removed ${tickerSymbol} from watchlist`);
    }
  }

  async refreshAllPrices() {
    const symbols = Object.keys(this.watchlist);
    if (symbols.length === 0) return;

    for (const refreshSymbol of symbols) {
      const price = await this.getStockPrice(refreshSymbol);
      if (price) {
        this.watchlist[refreshSymbol].currentPrice = price;
      }
    }
    
    await this.saveWatchlist();
    this.renderWatchlist();
    this.checkAlerts();
  }

  checkAlerts() {
    const alerts = [];
    
    Object.entries(this.watchlist).forEach(([alertSymbol, data]) => {
      const { currentPrice, low, high } = data;
      if (currentPrice && (currentPrice < low || currentPrice > high)) {
        const alertType = currentPrice < low ? 'BELOW' : 'ABOVE';
        alerts.push(`🚨 ${alertSymbol}: $${currentPrice} is ${alertType} threshold range ($${low}-$${high})`);
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
