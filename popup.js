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
    document.getElementById('processInput').addEventListener('click', () => this.processNaturalInput());
    document.getElementById('refreshAll').addEventListener('click', () => this.refreshAllPrices());
    document.getElementById('apiKey').addEventListener('change', () => this.saveSettings());
    document.getElementById('checkInterval').addEventListener('change', () => this.saveSettings());
    document.getElementById('enableNotifications').addEventListener('change', () => this.saveSettings());

    document.getElementById('toggleLogs').addEventListener('click', () => this.toggleLogs());
    document.getElementById('clearLogs').addEventListener('click', () => this.clearLogs());
    
    // Add debug button if it exists
    const debugBtn = document.getElementById('debugInfo');
    if (debugBtn) {
      debugBtn.addEventListener('click', () => this.showDebugInfo());
    }

    document.getElementById('naturalInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.processNaturalInput();
      }
    });

    // Event delegation for dynamically created watchlist buttons
    document.getElementById('watchlistContainer').addEventListener('click', (e) => {
      if (e.target.classList.contains('update-btn')) {
        const symbol = e.target.closest('[data-symbol]').dataset.symbol;
        this.updateThresholds(symbol);
      } else if (e.target.classList.contains('remove-btn')) {
        const symbol = e.target.closest('[data-symbol]').dataset.symbol;
        this.removeStock(symbol);
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
    this.saveLogs();
    
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

    const logsByIteration = {};
    this.logs.forEach(log => {
      if (!logsByIteration[log.iteration]) {
        logsByIteration[log.iteration] = [];
      }
      logsByIteration[log.iteration].push(log);
    });

    container.innerHTML = Object.entries(logsByIteration)
      .sort(([a], [b]) => parseInt(b) - parseInt(a))
      .slice(0, 10)
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

  validateUserInput(input) {
    if (!input || input.trim().length < 3) {
      return { valid: false, error: 'Please provide a more specific request (at least 3 characters)' };
    }
    
    // Check for common patterns
    const patterns = {
      addStock: /add|watch|monitor|track|follow/i,
      removeStock: /remove|delete|stop|unwatch/i,
      checkPrice: /price|current|now|quote/i,
      updateThreshold: /threshold|alert|percentage|range/i,
      generalStock: /stock|share|equity|ticker/i
    };
    
    const hasValidPattern = Object.values(patterns).some(pattern => pattern.test(input));
    
    if (!hasValidPattern) {
      return { valid: false, error: 'Please mention stocks, companies, or stock-related actions (add, watch, monitor, etc.)' };
    }
    
    return { valid: true, error: null };
  }

  async processNaturalInput() {
    const input = document.getElementById('naturalInput').value.trim();
    console.log('Input:', input);
    
    if (!input) return;

    if (!this.apiKey || this.apiKey.trim() === '') {
      alert('Please enter your Gemini API key in settings first!');
      return;
    }

    // Validate input before processing
    const validation = this.validateUserInput(input);
    if (!validation.valid) {
      this.showNotification('❌ ' + validation.error);
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
      let maxSteps = 6;
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

  buildContextPrompt(systemPrompt, userInput) {
    let contextPrompt = `${systemPrompt}\n\nUser request: ${userInput}`;
    
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
        .filter(step => step)
        .join('\n');
      
      contextPrompt += `\n\nPrevious steps completed:\n${previousSteps}\n\nWhat should I do next? Continue with the multi-step process.`;
    }
    
    return contextPrompt;
  }

  async makeGeminiRequestWithRetry(prompt, maxRetries = 3) {
    let retryCount = 0;
    
    while (retryCount < maxRetries) {
      try {
        const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + this.apiKey, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: prompt }]
            }]
          })
        });

        if (!response.ok) {
          throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        
        if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
          throw new Error('Invalid response structure from Gemini API');
        }
        
        return data.candidates[0].content.parts[0].text.trim();
        
      } catch (error) {
        retryCount++;
        console.log(`Gemini API attempt ${retryCount} failed:`, error.message);
        
        if (retryCount >= maxRetries) {
          throw new Error(`Failed after ${maxRetries} attempts: ${error.message}`);
        }
        
        // Wait before retry with exponential backoff
        await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
      }
    }
  }

  parseGeminiResponse(responseText) {
    // Normalize response
    const normalized = responseText.trim().toUpperCase();
    
    // Try multiple parsing strategies
    if (normalized.includes('FUNCTION_CALL:')) {
      return this.parseFunctionCall(responseText);
    } else if (normalized.includes('FINAL_ANSWER:')) {
      return this.parseFinalAnswer(responseText);
    } else if (normalized.includes('ERROR:')) {
      return this.parseError(responseText);
    } else {
      // Try to infer intent from natural language
      return this.inferIntent(responseText);
    }
  }

  parseFunctionCall(responseText) {
    // Handle multi-line responses - extract just the function call
    let functionCallLine = responseText;
    if (responseText.includes('\n')) {
      const lines = responseText.split('\n');
      for (const line of lines) {
        if (line.trim().toUpperCase().includes('FUNCTION_CALL:')) {
          functionCallLine = line.trim();
          break;
        }
      }
    }

    if (functionCallLine.toUpperCase().includes('FUNCTION_CALL:')) {
      const [, functionInfo] = functionCallLine.split(':', 2);
      
      if (!functionInfo) {
        throw new Error('Invalid function call format');
      }

      const functionInfoTrimmed = functionInfo.trim();
      
      // Handle case where Gemini returns "FUNCTION_CALL" as function name
      if (functionInfoTrimmed.toLowerCase() === 'function_call') {
        throw new Error('Gemini returned FUNCTION_CALL as function name - this indicates a parsing issue');
      }
      
      // Parse function call
      if (functionInfoTrimmed.includes('|')) {
        const parts = functionInfoTrimmed.split('|');
        const funcName = parts[0].trim();
        const params = parts.slice(1).map(p => p.trim()).filter(p => p.length > 0);
        
        // Additional validation for function name
        if (funcName.toLowerCase() === 'function_call') {
          throw new Error('Invalid function name: FUNCTION_CALL');
        }
        
        return { type: 'function_call', funcName, params };
      } else {
        const funcName = functionInfoTrimmed.trim();
        
        // Additional validation for function name
        if (funcName.toLowerCase() === 'function_call') {
          throw new Error('Invalid function name: FUNCTION_CALL');
        }
        
        return { type: 'function_call', funcName, params: [] };
      }
    }
    
    throw new Error('Could not parse function call');
  }

  parseFinalAnswer(responseText) {
    const lines = responseText.split('\n');
    for (const line of lines) {
      if (line.trim().toUpperCase().includes('FINAL_ANSWER:')) {
        const finalAnswer = line.split(':', 2)[1]?.trim() || 'Task completed';
        return { type: 'final_answer', content: finalAnswer };
      }
    }
    return { type: 'final_answer', content: 'Task completed' };
  }

  parseError(responseText) {
    const lines = responseText.split('\n');
    for (const line of lines) {
      if (line.trim().toUpperCase().includes('ERROR:')) {
        const errorMessage = line.split(':', 2)[1]?.trim() || 'Unknown error';
        return { type: 'error', content: errorMessage };
      }
    }
    return { type: 'error', content: 'Unknown error' };
  }

  inferIntent(responseText) {
    // Try to infer what the user wants based on keywords
    const text = responseText.toLowerCase();
    
    // Check if Gemini is trying to call a function but got confused
    if (text.includes('function_call') && text.includes(':')) {
      return { type: 'error', content: 'Gemini returned malformed function call. Please try rephrasing your request more clearly.' };
    }
    
    if (text.includes('add') || text.includes('watch') || text.includes('monitor')) {
      return { type: 'error', content: 'Please use FUNCTION_CALL format for adding stocks to watchlist' };
    }
    
    return { type: 'error', content: 'Could not understand the request. Please try rephrasing with clearer instructions.' };
  }

  addDebugInfo(response, step, context = '') {
    const debugInfo = {
      step,
      timestamp: new Date().toISOString(),
      iteration: this.currentIteration,
      rawResponse: response,
      context: context.substring(0, 200) + (context.length > 200 ? '...' : ''),
      parsedResponse: this.parseGeminiResponse(response)
    };
    
    console.log(`Step ${step} Debug Info:`, debugInfo);
    
    // Store debug info for troubleshooting
    if (!this.debugLogs) this.debugLogs = [];
    this.debugLogs.push(debugInfo);
    
    // Keep only last 10 debug entries
    if (this.debugLogs.length > 10) {
      this.debugLogs = this.debugLogs.slice(-10);
    }
  }

  getDebugSummary() {
    if (!this.debugLogs || this.debugLogs.length === 0) {
      return 'No debug information available';
    }
    
    const summary = this.debugLogs.map(log => 
      `Step ${log.step}: ${log.parsedResponse.type} - ${log.rawResponse.substring(0, 100)}...`
    ).join('\n');
    
    return `Debug Summary:\n${summary}`;
  }

  showDebugInfo() {
    const debugSummary = this.getDebugSummary();
    console.log('Debug Information:', debugSummary);
    
    // Show in a modal or alert for easy copying
    const debugWindow = window.open('', '_blank', 'width=600,height=400');
    debugWindow.document.write(`
      <html>
        <head><title>StockAlertAgent Debug Info</title></head>
        <body>
          <h2>Debug Information</h2>
          <pre style="white-space: pre-wrap; font-family: monospace;">${debugSummary}</pre>
          <button onclick="window.close()">Close</button>
        </body>
      </html>
    `);
  }

  async callGeminiAgentWithLogs(naturalInput) {
    // Enhanced system prompt with better examples and error handling
    const systemPrompt = `You are StockAlertAgent, an AI assistant for stock monitoring and watchlist management.

Available functions:
1. lookup_stock_symbol(company_name) - Find stock symbol for a company name
2. get_stock_price(symbol) - Get current stock price for a symbol
3. calculate_thresholds(price,percentage) - Calculate low/high thresholds from price and percentage (DEFAULT: 1% if no percentage specified)
4. add_to_watchlist(symbol,low,high) - Add stock to watchlist with specific thresholds

DEFAULT BEHAVIOR: If user doesn't specify a threshold percentage, use 1% as the default.

CRITICAL: You must respond with EXACTLY ONE of these formats (no other text):

For function calls:
FUNCTION_CALL: function_name|param1|param2

For completion:
FINAL_ANSWER: completion message

For errors:
ERROR: error description

Examples:
User: "Add Apple with 5% threshold"
Response: FUNCTION_CALL: lookup_stock_symbol|Apple

User: "Add Microsoft" (no threshold specified - will use 1% default)
Response: FUNCTION_CALL: lookup_stock_symbol|Microsoft

User: "Watch Tesla stock" (no threshold specified - will use 1% default)
Response: FUNCTION_CALL: lookup_stock_symbol|Tesla

User: "Task completed"
Response: FINAL_ANSWER: Successfully added stock to watchlist

User: "I don't understand"
Response: ERROR: Please specify which company you want to add to the watchlist

IMPORTANT RULES:
- NEVER include "FUNCTION_CALL" as the function name
- Use ONLY the actual function names: lookup_stock_symbol, get_stock_price, calculate_thresholds, add_to_watchlist
- Break down complex requests into individual steps
- Use results from previous function calls
- If no threshold percentage is specified, use 1% as default
- If confused, use ERROR: format to ask for clarification`;

    try {
      // Build context from previous iterations
      const contextPrompt = this.buildContextPrompt(systemPrompt, naturalInput);
      
      // Make API call with retry logic
      const responseText = await this.makeGeminiRequestWithRetry(contextPrompt);
      this.addLog('llm-response', responseText);

      // Add debug information
      this.addDebugInfo(responseText, 'gemini_response', contextPrompt);

      // Parse response using improved parsing logic
      let parsedResponse;
      try {
        parsedResponse = this.parseGeminiResponse(responseText);
      } catch (parseError) {
        this.addLog('error', `Parsing error: ${parseError.message}`);
        return { success: false, error: `Gemini response parsing failed: ${parseError.message}. Please try rephrasing your request.` };
      }
      
      if (parsedResponse.type === 'function_call') {
        this.addLog('function-call', { funcName: parsedResponse.funcName, params: parsedResponse.params });
        
        // Execute the function call
        const result = await this.executeFunctionCallWithLogs(parsedResponse.funcName, parsedResponse.params);
        this.addLog('result', result);
        
        return { success: 'continue', result };
      } else if (parsedResponse.type === 'final_answer') {
        this.addLog('final', parsedResponse.content);
        return { success: true, result: parsedResponse.content };
      } else if (parsedResponse.type === 'error') {
        this.addLog('error', parsedResponse.content);
        return { success: false, error: parsedResponse.content };
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
          if (params.length < 1) {
            throw new Error('Missing required parameter: price');
          }
          const [inputPrice, inputPercentage] = params;
          const priceNum = parseFloat(inputPrice);
          
          // Use 1% as default if no percentage specified
          const percentNum = params.length >= 2 ? parseFloat(inputPercentage) : 1.0;
          
          if (isNaN(priceNum)) {
            throw new Error(`Invalid price parameter: ${inputPrice}`);
          }
          
          if (isNaN(percentNum)) {
            throw new Error(`Invalid percentage parameter: ${inputPercentage}`);
          }
          
          const calcLow = Math.round(priceNum * (1 - percentNum/100) * 100) / 100;
          const calcHigh = Math.round(priceNum * (1 + percentNum/100) * 100) / 100;
          
          const defaultNote = params.length < 2 ? ' (using 1% default)' : '';
          return `Calculated thresholds: Low=$${calcLow}, High=$${calcHigh} (${percentNum}% of $${priceNum})${defaultNote}`;

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
      const searchQuery = encodeURIComponent(companyName);
      const searchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${searchQuery}&quotes_count=5&news_count=0`;
      
      const response = await fetch(searchUrl);
      const data = await response.json();
      
      if (data.quotes && data.quotes.length > 0) {
        const foundSymbol = data.quotes[0].symbol;
        console.log(`Found symbol for "${companyName}": ${foundSymbol}`);
        return foundSymbol;
      }
      
      const commonMappings = {
        'apple': 'AAPL',
        'google': 'GOOGL',
        'microsoft': 'MSFT',
        'amazon': 'AMZN',
        'tesla': 'TSLA',
        'meta': 'META',
        'facebook': 'META',
        'nvidia': 'NVDA',
        'yahoo': 'YHOO',
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
          <button class="update-btn" data-symbol="${tickerSymbol}">Update</button>
          <button class="remove-btn" data-symbol="${tickerSymbol}">Remove</button>
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
        message: alerts[0],
        priority: 2
      });
    }
  }

  async startPeriodicCheck() {
    const interval = parseInt(document.getElementById('checkInterval').value) || 30;
    chrome.alarms.clear('stockCheck');
    chrome.alarms.create('stockCheck', { periodInMinutes: interval });
  }

  showNotification(message) {
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
