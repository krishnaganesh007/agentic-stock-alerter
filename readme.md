# 📈 StockAlertAgent

An AI-powered Chrome extension for intelligent stock monitoring with natural language input and multi-step reasoning powered by Google's Gemini API.

## 🌟 Features

- **Natural Language Input**: Simply type "Watch AAPL with 5% threshold" or "Add Tesla to watchlist"
- **AI-Powered Orchestration**: Gemini AI breaks down requests into multi-step workflows
- **Intelligent Symbol Lookup**: Converts company names to stock symbols automatically
- **Dynamic Threshold Calculation**: AI suggests optimal thresholds based on volatility
- **Real-time Price Monitoring**: Background monitoring with customizable intervals
- **Browser Notifications**: Get alerted when stocks cross your thresholds
- **Detailed Agent Logs**: See exactly how the AI thinks through each step
- **Editable Thresholds**: Modify price ranges directly in the interface

## 🚀 Quick Start

### Prerequisites

- Google Chrome browser
- Gemini API key ([Get one here](https://aistudio.google.com/app/api-keys))

### Installation

1. **Clone the repository**
git clone https://github.com/krishnaganesh007/agentic-stock-alerter.git
cd stock-alert-agent

text

2. **Load the extension**
- Open Chrome and go to `chrome://extensions/`
- Enable "Developer mode" (top right toggle)
- Click "Load unpacked" and select the project folder

3. **Configure API Key**
- Click the extension icon in your browser
- Open Settings section
- Enter your Gemini API key
- Set monitoring interval (default: 30 minutes)

## 💡 Usage Examples

### Basic Commands
- `"Watch Apple stock"`
- `"Add Google with 3% threshold"`
- `"Monitor Tesla with volatility-based thresholds"`
- `"Track Microsoft and alert me"`

### The AI Agent Process
When you input a command, the AI agent:

1. **🔍 Symbol Lookup**: `lookup_stock_symbol|Apple` → `AAPL`
2. **💰 Price Retrieval**: `get_stock_price|AAPL` → `$180.50`
3. **📊 Threshold Calculation**: `calculate_thresholds|180.50|5` → `Low: $171.48, High: $189.53`
4. **📝 Watchlist Addition**: `add_to_watchlist|AAPL|171.48|189.53`
5. **✅ Task Completion**: Final confirmation

## 🏗️ Architecture

### File Structure
stock-alert-agent/
├── manifest.json # Extension configuration
├── popup.html # Main interface
├── popup.js # Core application logic
├── background.js # Background monitoring
├── styles.css # UI styling
├── lib/
│ └── gemini-client.js # Gemini API integration
└── assets/
└── icon.png # Extension icon

text

### Core Components

- **StockAlertExtension Class**: Main application controller
- **Gemini AI Integration**: Multi-step reasoning and orchestration
- **Yahoo Finance API**: Real-time stock data retrieval
- **Chrome Storage API**: Persistent data storage
- **Chrome Alarms API**: Background monitoring

## 🛠️ Technical Details

### AI Agent Functions

The extension provides these functions to the Gemini AI:

// Symbol lookup
lookup_stock_symbol(company_name)

// Price retrieval
get_stock_price(symbol)

// Threshold calculation
calculate_thresholds(price, percentage)

// Watchlist management
add_to_watchlist(symbol, low, high)

text

### Data Storage

- **Watchlist**: Stored in `chrome.storage.local`
- **Settings**: Stored in `chrome.storage.sync`
- **Agent Logs**: Stored in `chrome.storage.local`

### Background Processing

- Uses Chrome Alarms API for periodic price checks
- Sends browser notifications for threshold breaches
- Runs independently of popup interface

## 🎨 UI Features

### Main Interface
- Clean, modern design with gradient header
- Responsive textarea for natural language input
- Real-time stock price display with color coding
- Editable threshold controls per stock

### Agent Logs
- Collapsible log viewer showing AI decision-making
- Step-by-step breakdown of agent reasoning
- Color-coded log entries (input, LLM response, function calls, results)
- Session-based organization

### Status Indicators
- ✅ Green: Price within range
- 🚨 Red alert badge: Price outside thresholds
- 📊 Real-time price updates

## ⚙️ Configuration

### Settings Panel
- **API Key**: Your Gemini API key
- **Check Interval**: 5, 15, 30, or 60 minutes
- **Notifications**: Enable/disable browser alerts

### Threshold Methods
- **Percentage-based**: Simple % above/below current price
- **Volatility-based**: Based on historical stock volatility
- **Moving Average**: Deviation from 20-day MA

## 🔧 Development

### Local Setup
No build process required - pure HTML/CSS/JS
Simply load the extension folder in Chrome
text

### API Integration
The extension integrates with:
- **Gemini 2.0 Flash**: For AI agent orchestration
- **Yahoo Finance**: For real-time stock data
- **Chrome APIs**: For storage, alarms, and notifications

### Debugging
- Use Chrome DevTools (F12) on the extension popup
- Check console logs for detailed API interactions
- Agent logs show step-by-step AI reasoning

## 🚨 Limitations

- Requires active internet connection
- Gemini API rate limits apply
- Yahoo Finance API may have usage restrictions
- Background monitoring limited by Chrome extension permissions

## 📝 License

MIT License - see [LICENSE](LICENSE) for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 🆘 Support

- **Issues**: Report bugs via GitHub Issues
- **API Key**: Get your Gemini API key at [Google AI Studio](https://makersuite.google.com/)
- **Chrome Extensions**: Learn more at [Chrome Developers](https://developer.chrome.com/docs/extensions/)

---

**Built with ❤️ using Gemini AI, Chrome APIs, and modern web technologies**