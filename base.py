import os
import time
import threading
import schedule
import re
from datetime import datetime
from dotenv import load_dotenv
from google import genai
import yfinance as yf
import numpy as np

# Load environment variables from .env file
load_dotenv()

# Access your API key
api_key = os.getenv("GEMINI_API_KEY")

# Global watchlist dictionary
watchlist = {}

# Core Functions
def get_stock_price(symbol):
    """Get current stock price using yfinance"""
    try:
        symbol = symbol.upper().strip()
        ticker = yf.Ticker(symbol)
        todays_data = ticker.history(period='1d')
        if todays_data.empty:
            return None
        return round(float(todays_data['Close'].iloc[-1]), 2)
    except Exception as e:
        print(f"Error getting price for {symbol}: {e}")
        return None

def suggest_thresholds(symbol, method="percentage", percentage=5, days=30):
    """
    Suggest threshold values for a stock based on different methods
    
    Args:
        symbol: Stock symbol
        method: "percentage", "volatility", or "moving_average"
        percentage: Percentage above/below current price (for percentage method)
        days: Number of days for historical analysis
    
    Returns:
        Dictionary with suggested low and high thresholds
    """
    try:
        symbol = symbol.upper().strip()
        ticker = yf.Ticker(symbol)
        
        # Get historical data
        hist_data = ticker.history(period=f"{days}d")
        if hist_data.empty:
            return f"Could not fetch historical data for {symbol}"
        
        current_price = hist_data['Close'].iloc[-1]
        
        if method == "percentage":
            # Simple percentage-based thresholds
            low_threshold = round(current_price * (1 - percentage/100), 2)
            high_threshold = round(current_price * (1 + percentage/100), 2)
            
            return {
                "symbol": symbol,
                "current_price": round(current_price, 2),
                "method": f"{percentage}% above/below current price",
                "low": low_threshold,
                "high": high_threshold,
                "reasoning": f"Based on {percentage}% movement from current price of ${current_price:.2f}"
            }
            
        elif method == "volatility":
            # Volatility-based thresholds using standard deviation
            returns = hist_data['Close'].pct_change().dropna()
            if len(returns) < 5:
                return f"Not enough data for volatility analysis of {symbol}"
            
            volatility = returns.std()
            daily_volatility = volatility * np.sqrt(252)  # Annualized volatility
            
            # Use 1 standard deviation as threshold
            price_change = current_price * volatility
            low_threshold = round(current_price - price_change, 2)
            high_threshold = round(current_price + price_change, 2)
            
            return {
                "symbol": symbol,
                "current_price": round(current_price, 2),
                "method": "Historical volatility (1 std dev)",
                "low": low_threshold,
                "high": high_threshold,
                "volatility": round(daily_volatility * 100, 2),
                "reasoning": f"Based on {days}-day historical volatility of {daily_volatility*100:.2f}%"
            }
            
        elif method == "moving_average":
            # Moving average based thresholds
            if len(hist_data) < 20:
                return f"Not enough data for moving average analysis of {symbol}"
            
            # Calculate 20-day moving average
            ma_20 = hist_data['Close'].rolling(window=20).mean().iloc[-1]
            
            # Use deviation from moving average
            deviation = abs(current_price - ma_20)
            low_threshold = round(current_price - deviation * 1.5, 2)
            high_threshold = round(current_price + deviation * 1.5, 2)
            
            return {
                "symbol": symbol,
                "current_price": round(current_price, 2),
                "method": "Moving Average deviation",
                "low": low_threshold,
                "high": high_threshold,
                "ma_20": round(ma_20, 2),
                "reasoning": f"Based on deviation from 20-day MA of ${ma_20:.2f}"
            }
            
        else:
            return f"Unknown method: {method}. Use 'percentage', 'volatility', or 'moving_average'"
            
    except Exception as e:
        return f"Error calculating thresholds for {symbol}: {str(e)}"

def add_to_watchlist_with_suggestions(symbol, method="percentage", percentage=5):
    """Add stock to watchlist using suggested thresholds"""
    suggestions = suggest_thresholds(symbol, method, percentage)
    
    if isinstance(suggestions, str):  # Error message
        return suggestions
    
    # Add to watchlist using suggested values
    result = add_to_watchlist(symbol, suggestions["low"], suggestions["high"])
    
    return f"{result}\nSuggestion details: {suggestions['reasoning']}"

def add_to_watchlist(symbol, low_threshold, high_threshold):
    """Add a stock to the watchlist with thresholds"""
    global watchlist
    symbol = symbol.upper().strip()
    watchlist[symbol] = {
        'low': float(low_threshold),
        'high': float(high_threshold),
        'added_at': datetime.now().isoformat()
    }
    return f"Added {symbol} to watchlist: Low={low_threshold}, High={high_threshold}"

def remove_from_watchlist(symbol):
    """Remove a stock from the watchlist"""
    global watchlist
    symbol = symbol.upper().strip()
    if symbol in watchlist:
        del watchlist[symbol]
        return f"Removed {symbol} from watchlist"
    return f"{symbol} not found in watchlist"

def get_watchlist():
    """Return current watchlist"""
    if not watchlist:
        return "Watchlist is empty"
    
    result = "Current Watchlist:\n"
    for symbol, data in watchlist.items():
        result += f"- {symbol}: Low={data['low']}, High={data['high']}\n"
    return result.strip()

def check_price_limit(price, low, high):
    """Check if price is outside the threshold range"""
    if price < low or price > high:
        return True
    return False

def generate_alert(alert_status, symbol, price, low, high):
    """Generate alert message if alert status is True"""
    if alert_status:
        if price < low:
            return f"🚨 ALERT: {symbol} price ${price} is BELOW threshold range ({low}, {high})"
        elif price > high:
            return f"🚨 ALERT: {symbol} price ${price} is ABOVE threshold range ({low}, {high})"
    return None

def monitor_all_stocks():
    """Check all stocks in watchlist and return alert status"""
    if not watchlist:
        return "No stocks in watchlist to monitor"
    
    alerts = []
    status_report = f"Monitoring Report - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
    
    for symbol, thresholds in watchlist.items():
        price = get_stock_price(symbol)
        if price is None:
            status_report += f"- {symbol}: Could not fetch price\n"
            continue
            
        is_alert = check_price_limit(price, thresholds['low'], thresholds['high'])
        
        if is_alert:
            alert_msg = generate_alert(True, symbol, price, thresholds['low'], thresholds['high'])
            alerts.append(alert_msg)
            status_report += f"- {symbol}: ${price} ⚠️ OUT OF RANGE\n"
        else:
            status_report += f"- {symbol}: ${price} ✅ In range\n"
    
    if alerts:
        return status_report + "\nALERTS:\n" + "\n".join(alerts)
    else:
        return status_report + "\nAll stocks within range"

def schedule_monitoring(interval_minutes):
    """Set up monitoring schedule (placeholder for now)"""
    return f"Monitoring scheduled for every {interval_minutes} minutes"

# Helper function to parse parameters
def parse_param(param):
    """Parse parameter string to appropriate type"""
    param = param.strip()
    # Check if param looks like a number (int or float)
    try:
        if '.' in param:
            return float(param)
        else:
            return int(param)
    except ValueError:
        # Not a number, treat as string (remove quotes if any)
        return param.strip("\"'")

# Function caller
def function_caller(func_name, params):
    """Route function calls to appropriate functions"""
    function_map = {
        "get_stock_price": get_stock_price,
        "suggest_thresholds": suggest_thresholds,
        "add_to_watchlist": add_to_watchlist,
        "add_to_watchlist_with_suggestions": add_to_watchlist_with_suggestions,
        "remove_from_watchlist": remove_from_watchlist,
        "get_watchlist": get_watchlist,
        "check_price_limit": check_price_limit,
        "generate_alert": generate_alert,
        "monitor_all_stocks": monitor_all_stocks,
        "schedule_monitoring": schedule_monitoring
    }
    
    if func_name in function_map:
        if isinstance(params, list):
            if len(params) == 0:
                return function_map[func_name]()
            elif len(params) == 1:
                return function_map[func_name](params[0])
            else:
                return function_map[func_name](*params)
        else:
            return function_map[func_name](params)
    else:
        return f"Function {func_name} not found"

# Agent System
def run_stock_agent(query, max_iterations=10):
    """Run the stock monitoring agent with given query"""
    
    # Enhanced system prompt for the agent
    system_prompt = """You are StockAlertAgent - a stock watchlist monitoring agent. Respond with EXACTLY ONE of these formats:
1. FUNCTION_CALL: python_function_name|input
2. FINAL_ANSWER: message

Available functions:
1. get_stock_price(symbol) - Get current stock price for a symbol
2. suggest_thresholds(symbol|method|percentage) - Suggest threshold values using different methods
   - method: "percentage" (default), "volatility", or "moving_average" 
   - percentage: number for percentage method (default 5%)
3. add_to_watchlist(symbol|low_threshold|high_threshold) - Add stock to monitoring watchlist
4. add_to_watchlist_with_suggestions(symbol|method|percentage) - Add stock using suggested thresholds
5. remove_from_watchlist(symbol) - Remove stock from watchlist
6. get_watchlist - Get current watchlist with all stocks and thresholds (NO parameters)
7. check_price_limit(price|low|high) - Check if price is outside threshold range
8. generate_alert(alert_status|symbol|price|low|high) - Generate alert message
9. monitor_all_stocks - Check all stocks in watchlist for alerts (NO parameters)
10. schedule_monitoring(interval_minutes) - Set up continuous monitoring

For functions with NO parameters, just use: FUNCTION_CALL: function_name
For functions with parameters, use: FUNCTION_CALL: function_name|param1|param2

Think through the task step by step and decide what functions to call. DO NOT include multiple responses. Give ONE response at a time."""

    iteration = 0
    iteration_response = []
    last_response = None
    
    print(f"🤖 Starting StockAlertAgent with query: {query}")
    print("=" * 60)
    
    while iteration < max_iterations:
        print(f"\n--- Iteration {iteration + 1} ---")
        
        if last_response is None:
            prompt_query = query
        else:
            context = " ".join(iteration_response[-3:])  # Keep last 3 iterations for context
            prompt_query = f"{query}\n\nContext: {context}\n\nWhat should I do next?"

        prompt = f"{system_prompt}\n\nQuery: {prompt_query}"
        
        # Get Gemini response
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt
        )
        
        response_text = response.text.strip()
        print(f"🧠 LLM Response: {response_text}")
        
        if response_text.startswith("FUNCTION_CALL:") or "FUNCTION_CALL:" in response_text:
            # Handle multi-line responses - extract just the function call
            if "FUNCTION_CALL:" in response_text:
                lines = response_text.split('\n')
                function_call_line = None
                for line in lines:
                    if line.strip().startswith("FUNCTION_CALL:"):
                        function_call_line = line.strip()
                        break
                
                if function_call_line:
                    response_text = function_call_line
                else:
                    print(f"⚠️ Could not find FUNCTION_CALL in response")
                    continue
            
            _, function_info = response_text.split(":", 1)
            function_info = function_info.strip()
            
            # Parse function call
            if "|" in function_info:
                parts = re.split(r'[|,]', function_info.strip())
                func_name = parts[0].strip()
                param_parts = parts[1:] if len(parts) > 1 else []
                # Filter out empty parameters
                param_parts = [p for p in param_parts if p.strip()]
                params = [parse_param(p) for p in param_parts]
            else:
                # No parameters
                func_name = function_info.strip()
                params = []
            
            print(f"🔧 Calling: {func_name}({params})")
            
            # Execute function
            try:
                iteration_result = function_caller(func_name, params)
                print(f"✅ Result: {iteration_result}")
                
                # Add to iteration history
                iteration_response.append(f"Iteration {iteration + 1}: Called {func_name}({params}) -> {iteration_result}")
                last_response = iteration_result
                
            except Exception as e:
                error_msg = f"Error executing {func_name}: {e}"
                print(f"❌ {error_msg}")
                iteration_response.append(f"Iteration {iteration + 1}: Error in {func_name}: {e}")
        
        elif response_text.startswith("FINAL_ANSWER:"):
            print("\n" + "=" * 60)
            print("🎯 StockAlertAgent Execution Complete")
            final_answer = response_text.split(":", 1)[1].strip()
            print(f"📋 Final Answer: {final_answer}")
            print("=" * 60)
            break
        
        else:
            print(f"⚠️ Unexpected response format: {response_text}")
        
        iteration += 1

    if iteration >= max_iterations:
        print("\n⏰ Max iterations reached")
    
    return watchlist

# Continuous monitoring functions
def continuous_monitor():
    """Continuously monitor all stocks in watchlist"""
    print("🔄 Starting continuous monitoring...")
    
    def check_stocks():
        if watchlist:
            result = monitor_all_stocks()
            print(f"\n{result}")
        else:
            print("📭 No stocks in watchlist to monitor")
    
    # Schedule monitoring every 30 minutes
    schedule.every(30).minutes.do(check_stocks)
    
    # Run initial check
    check_stocks()
    
    while True:
        schedule.run_pending()
        time.sleep(60)  # Check every minute

def start_background_monitoring():
    """Start monitoring in background thread"""
    monitor_thread = threading.Thread(target=continuous_monitor, daemon=True)
    monitor_thread.start()
    print("🚀 Background monitoring started")

# Main execution
if __name__ == "__main__":
    # Example queries you can use:
    
    # Query 1: Add single stock with suggested thresholds
    query1 = "Add AAPL to watchlist using suggested thresholds with 5% percentage method"
    
    # Query 2: Get threshold suggestions first
    query2 = "Suggest thresholds for GOOGL using volatility method, then add to watchlist if they look good"
    
    # Query 3: Add multiple stocks with different methods
    query3 = "Add AAPL using 3% percentage method and TSLA using volatility method to watchlist, then monitor all"
    
    # Query 4: Check current watchlist and monitor
    query4 = "Show me current watchlist and monitor all stocks for alerts"
    
    # Query 5: Suggest thresholds using moving average
    query5 = "Suggest thresholds for MSFT using moving average method and show reasoning"
    
    # Run the agent
    print("🎯 StockAlertAgent - AI-Powered Stock Monitoring")
    print("=" * 60)
    
    # Choose which query to run
    chosen_query = query3  # Change this to any query above
    
    # Run the agent
    final_watchlist = run_stock_agent(chosen_query)
    
    print(f"\n📊 Final Watchlist Status:")
    if final_watchlist:
        for symbol, data in final_watchlist.items():
            print(f"  {symbol}: ${data['low']} - ${data['high']}")
    else:
        print("  No stocks in watchlist")
    
    # Optionally start continuous monitoring
    # Uncomment the next lines to start background monitoring
    # print("\n🚀 Starting background monitoring...")
    # start_background_monitoring()
    # print("Background monitoring running. Press Ctrl+C to stop.")
    # try:
    #     while True:
    #         time.sleep(1)
    # except KeyboardInterrupt:
    #     print("\n👋 StockAlertAgent stopped")
