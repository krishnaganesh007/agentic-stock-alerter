import os
import time
import threading
import schedule
import re
from datetime import datetime
from dotenv import load_dotenv
from google import genai
import yfinance as yf

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
        "add_to_watchlist": add_to_watchlist,
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
    
    # System prompt for the agent
    system_prompt = """You are a stock watchlist monitoring agent. Respond with EXACTLY ONE of these formats:
1. FUNCTION_CALL: python_function_name|input
2. FINAL_ANSWER: message

Available functions:
1. get_stock_price(symbol) - Get current stock price for a symbol
2. add_to_watchlist(symbol|low_threshold|high_threshold) - Add stock to monitoring watchlist
3. remove_from_watchlist(symbol) - Remove stock from watchlist
4. get_watchlist() - Get current watchlist with all stocks and thresholds
5. check_price_limit(price|low|high) - Check if price is outside threshold range
6. generate_alert(alert_status|symbol|price|low|high) - Generate alert message
7. monitor_all_stocks() - Check all stocks in watchlist for alerts
8. schedule_monitoring(interval_minutes) - Set up continuous monitoring

Think through the task step by step and decide what functions to call. DO NOT include multiple responses. Give ONE response at a time."""

    iteration = 0
    iteration_response = []
    last_response = None
    
    print(f"🤖 Starting Stock Agent with query: {query}")
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
            model="gemini-2.0-flash",
            contents=prompt
        )
        
        response_text = response.text.strip()
        print(f"🧠 LLM Response: {response_text}")
        
        if response_text.startswith("FUNCTION_CALL:"):
            _, function_info = response_text.split(":", 1)
            function_info = function_info.strip()
            
            # Parse function call using regex for multiple delimiters
            parts = re.split(r'[|,]', function_info.strip())
            func_name = parts[0].strip()
            param_parts = parts[1:] if len(parts) > 1 else []
            params = [parse_param(p) for p in param_parts]
            
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
            print("🎯 Agent Execution Complete")
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
    
    # Query 1: Add single stock to watchlist
    query1 = "Add AAPL stock to watchlist with range (240, 245) and check if current price needs alert"
    
    # Query 2: Monitor multiple stocks
    query2 = "Add AAPL (240, 245), GOOGL (130, 140), and TSLA (200, 220) to watchlist then monitor all for alerts"
    
    # Query 3: Check current watchlist
    query3 = "Show me current watchlist and monitor all stocks for alerts"
    
    # Run the agent
    print("🎯 Stock Monitoring Agent")
    print("=" * 60)
    
    # Choose which query to run
    chosen_query = query1  # Change this to query2 or query3 as needed
    
    # Run the agent
    final_watchlist = run_stock_agent(chosen_query)
    
    # Optionally start continuous monitoring
    # Uncomment the next two lines to start background monitoring
    # start_background_monitoring()
    # print("Background monitoring running. Press Ctrl+C to stop.")
    # try:
    #     while True:
    #         time.sleep(1)
    # except KeyboardInterrupt:
    #     print("\n👋 Monitoring stopped")
