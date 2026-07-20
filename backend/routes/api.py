from flask import Blueprint, jsonify, request
from werkzeug.security import generate_password_hash, check_password_hash
import finnhub
import numpy as np
import pandas as pd
import yfinance as yf
from concurrent.futures import ThreadPoolExecutor, as_completed
import time, random
from datetime import datetime, timedelta

from ..config import Config
from ..models import db, User, Stock, Portfolio, Holding, Transaction

# Safe, defensive imports for scipy
LINREGRESS_AVAILABLE = False
try:
    from scipy.stats import linregress
    LINREGRESS_AVAILABLE = True
except Exception as e:
    print(f"AI-Prediction WARNING: scipy.stats.linregress could not be loaded: {e}. Falling back to NumPy implementation.")

def _safe_linregress(x, y):
    if LINREGRESS_AVAILABLE:
        try:
            return linregress(x, y)
        except Exception:
            pass
    # Custom simple linear regression using NumPy
    n = len(x)
    if n == 0:
        return 0.0, 0.0, 0.0, 0.0, 0.0
    x_mean = np.mean(x)
    y_mean = np.mean(y)
    num = np.sum((x - x_mean) * (y - y_mean))
    den = np.sum((x - x_mean) ** 2)
    slope = num / den if den != 0.0 else 0.0
    intercept = y_mean - (slope * x_mean)
    return slope, intercept, 0.0, 0.0, 0.0

# Safe, defensive imports for Chronos & PyTorch
CHRONOS_AVAILABLE = False
ChronosClass = None
torch = None

try:
    import torch
    from chronos import ChronosBoltPipeline
    ChronosClass = ChronosBoltPipeline
    CHRONOS_AVAILABLE = True
    print("AI-Prediction: Successfully loaded ChronosBoltPipeline")
except Exception as e:
    if torch is not None:
        try:
            from chronos import ChronosPipeline
            ChronosClass = ChronosPipeline
            CHRONOS_AVAILABLE = True
            print("AI-Prediction: Fallback loaded ChronosPipeline")
        except Exception as fallback_err:
            print(f"AI-Prediction WARNING: Chronos pipelines not importable. Error: {fallback_err}")
    else:
        print(f"AI-Prediction WARNING: PyTorch could not be loaded, Chronos disabled. (This is normal if an Application Control policy blocks PyTorch dlls.) Error: {e}")

# Initialize Finnhub Client
finnhub_client = finnhub.Client(api_key=Config.FINNHUB_API_KEY)

# Price cache: {ticker: {price, change, change_pct, timestamp}}
_price_cache = {}
_cache_ttl = 25  # seconds

def _fetch_single_quote(ticker, latest_db_price):
    try:
        quote = finnhub_client.quote(ticker)
        if quote and 'c' in quote and quote['c']:
            return ticker, {
                'price': quote.get('c', latest_db_price),
                'change': quote.get('d', 0),
                'change_pct': quote.get('dp', 0)
            }
    except Exception:
        pass
    return ticker, {
        'price': latest_db_price,
        'change': 0,
        'change_pct': 0
    }

def _get_cached_price(ticker, fallback):
    cached = _price_cache.get(ticker)
    now = time.time()
    if cached and (now - cached['timestamp']) < _cache_ttl:
        return cached['price']
    return fallback


def calculate_rsi(prices, period=14):
    if len(prices) < period + 1:
        return 50.0

    deltas = np.diff(prices)
    seed = deltas[:period]
    up = seed[seed >= 0].sum() / period
    down = -seed[seed < 0].sum() / period
    rs = up / (down if down != 0 else 0.00001)
    rsi = np.zeros_like(prices, dtype=float)
    rsi[:period] = 100.0 - 100.0 / (1.0 + rs)

    for i in range(period, len(prices)):
        delta = deltas[i - 1]
        if delta > 0:
            up_val = delta
            down_val = 0.0
        else:
            up_val = 0.0
            down_val = -delta
        up = (up * (period - 1) + up_val) / period
        down = (down * (period - 1) + down_val) / period
        rs = up / (down if down != 0 else 0.00001)
        rsi[i] = 100.0 - 100.0 / (1.0 + rs)

    return float(rsi[-1])


def get_chronos_pipeline():
    if not CHRONOS_AVAILABLE or ChronosClass is None:
        return None
    try:
        model_name = "amazon/chronos-bolt-tiny" if ChronosClass.__name__ == "ChronosBoltPipeline" else "amazon/chronos-t5-tiny"
        pipeline = ChronosClass.from_pretrained(
            model_name,
            device_map="cpu",
            torch_dtype=torch.float32,
        )
        return pipeline
    except Exception as e:
        print(f"AI-Prediction WARNING: Chronos pipeline could not be loaded: {e}")
        return None


def get_ensemble_recommendation(ticker_symbol, user_cash, user_holdings, historical_data, live_price=None, fallback_used=False):
    # Allow callers to pass None - if so and live_price is provided, build a synthetic history
    if historical_data is None or historical_data.empty or 'Close' not in historical_data.columns:
        if live_price is None:
            return {"error": "No historical data found"}
        # build synthetic history using live_price
        days = 60
        dates = pd.date_range(end=pd.Timestamp.today(), periods=days)
        historical_data = pd.DataFrame({'Close': [float(live_price)] * days}, index=dates)

    close_prices = historical_data['Close'].dropna().astype(float)
    if close_prices.empty:
        return {"error": "No historical data found"}

    current_price = float(live_price) if live_price else float(close_prices.iloc[-1])
    current_price = max(current_price, 0.01)
    n_days = len(close_prices)

    # --- Linear Regression Trend ---
    regression_window = min(30, n_days)
    x = np.arange(regression_window)
    y = close_prices.iloc[-regression_window:].values
    slope, intercept, _, _, _ = _safe_linregress(x, y)
    regression_forecast = current_price + (slope * 5.0)

    # --- EMA Momentum ---
    ema_12 = close_prices.ewm(span=12, adjust=False).mean().iloc[-1]
    ema_26 = close_prices.ewm(span=26, adjust=False).mean().iloc[-1]
    ema_momentum = float(ema_12 - ema_26)
    ema_forecast = current_price + (ema_momentum * 1.5)

    # --- MACD / RSI Indicators ---
    macd_line = close_prices.ewm(span=12, adjust=False).mean() - close_prices.ewm(span=26, adjust=False).mean()
    signal_line = macd_line.ewm(span=9, adjust=False).mean()
    macd_hist = macd_line - signal_line
    macd_signal = float(macd_line.iloc[-1] - signal_line.iloc[-1])

    # Handle constant/synthetic series: avoid spurious RSI=0
    synthetic_series = np.allclose(close_prices, close_prices.iloc[0]) if len(close_prices) > 0 else False
    if synthetic_series:
        rsi_value = 50.0
    else:
        delta = close_prices.diff()
        gain = delta.clip(lower=0).rolling(window=14).mean()
        loss = -delta.clip(upper=0).rolling(window=14).mean()
        rs = gain / (loss + 1e-9)
        rsi_value = float(round(100 - (100 / (1 + rs.iloc[-1])), 2)) if len(rs.dropna()) > 0 else 50.0

    chronos_forecast_val = None
    pipeline = get_chronos_pipeline()
    if pipeline is not None:
        try:
            context = torch.tensor(close_prices.values[-60:], dtype=torch.float32)
            if context.ndim == 1:
                context = context.unsqueeze(0)
            forecast = pipeline.predict(context, 5)
            if isinstance(forecast, (list, tuple)) and len(forecast) > 0:
                forecast_data = forecast[0]
            else:
                forecast_data = forecast
            forecast_arr = np.asarray(forecast_data, dtype=float)
            if forecast_arr.ndim == 2:
                chronos_forecast_val = float(np.median(forecast_arr, axis=0)[-1])
            else:
                chronos_forecast_val = float(np.ravel(forecast_arr)[-1])
        except Exception as e:
            print(f"AI-Prediction WARNING: Chronos forecast failed: {e}")
            chronos_forecast_val = None

    if chronos_forecast_val is not None:
        predicted_price_5d = (0.40 * chronos_forecast_val) + (0.40 * ema_forecast) + (0.20 * regression_forecast)
    else:
        predicted_price_5d = (0.60 * ema_forecast) + (0.40 * regression_forecast)

    max_deviation = current_price * 0.15
    predicted_price_5d = float(np.clip(predicted_price_5d, current_price - max_deviation, current_price + max_deviation))
    predicted_price_5d = float(round(predicted_price_5d, 2))

    price_change_pct = ((predicted_price_5d - current_price) / current_price) * 100.0
    recommendation = "HOLD"

    if price_change_pct >= 4.0 and rsi_value < 70:
        recommendation = "BUY"
    elif price_change_pct >= 1.5 and rsi_value < 65:
        recommendation = "BUY"
    elif (not synthetic_series) and rsi_value < 30 and price_change_pct > -2.0:
        # only treat oversold-as-buy if we have real history
        recommendation = "BUY"
    elif price_change_pct <= -2.0 or (rsi_value > 75 and price_change_pct < -1.0):
        recommendation = "SELL"
    elif price_change_pct <= -1.5 and macd_signal < 0:
        recommendation = "SELL"

    # If history is synthetic/flat, prefer HOLD unless there is clear loss signal
    if synthetic_series and recommendation == "BUY":
        recommendation = "HOLD"

    suggested_shares = 0
    action = recommendation
    # Suggest buy quantity limited by available cash (max 20% of cash)
    if recommendation == "BUY":
        try:
            available_cash = float(user_cash)
            max_commit = available_cash * 0.20
            suggested_shares = int(max_commit // current_price)
            if suggested_shares <= 0:
                # Not enough cash to buy at least one share
                action = "HOLD"
        except Exception:
            suggested_shares = 0
            action = "HOLD"

    # If recommendation is SELL, ensure user actually holds shares before suggesting any sells
    suggested_sell_qty = 0
    if recommendation == "SELL":
        if int(user_holdings) <= 0:
            action = "HOLD"
        else:
            # Determine sell fraction based on signal strength
            sell_fraction = 0.25  # default partial sell
            # Strong sell conditions increase sell fraction
            if price_change_pct <= -4.0 or rsi_value > 85 or macd_signal < -0.5:
                sell_fraction = 0.75
            elif price_change_pct <= -2.5 or rsi_value > 80 or macd_signal < -0.2:
                sell_fraction = 0.5
            suggested_sell_qty = max(1, int(user_holdings * sell_fraction))
            suggested_shares = suggested_sell_qty

    step_values = np.linspace(current_price, predicted_price_5d, 5)[1:]
    forecast_series = [float(round(x, 2)) for x in step_values]

    # Confidence scoring (0-100)
    try:
        conf_from_price = min(50, abs(price_change_pct) * 5)
        conf_from_rsi = min(30, abs(rsi_value - 50) * 0.6)
        conf_from_macd = min(20, abs(macd_signal) * 10)
        confidence = int(min(100, conf_from_price + conf_from_rsi + conf_from_macd))
    except Exception:
        confidence = 50

    # Human-readable reason
    if price_change_pct > 0.2:
        change_text = f"AI projects positive growth (+{round(price_change_pct, 2)}%) over the next 5 days."
    elif price_change_pct < -0.2:
        change_text = f"AI projects a downward correction ({round(price_change_pct, 2)}%) over the next 5 days."
    else:
        change_text = "AI projects stable/sideways movement over the next 5 days."

    if rsi_value > 70:
        momentum_text = "Overheated (High Selling Pressure)"
    elif rsi_value < 30:
        momentum_text = "Oversold (Potential Buy Zone)"
    elif rsi_value >= 55:
        momentum_text = "Strong Momentum"
    elif rsi_value < 45:
        momentum_text = "Weak Momentum"
    else:
        momentum_text = "Steady & Neutral"

    trend_text = "Upward Trend Strength" if macd_signal >= 0 else "Downward Trend Correction"
    reason = f"{change_text} Market Momentum is {momentum_text} with an {trend_text}."

    if fallback_used:
        reason += " Data fallback was used for this estimate."

    return {
        "current_price": current_price,
        "predicted_price_5d": predicted_price_5d,
        "rsi": float(rsi_value),
        "macd_signal": float(macd_signal),
        "recommendation": recommendation,
        "action": action,
        "suggested_qty": int(suggested_shares),
        "reason": reason,
        "confidence": confidence,
        "fallback_used": bool(fallback_used),
        "forecast_series": forecast_series
    }


def get_all_prices():
    stocks = Stock.query.all()
    now = time.time()
    result = []
    need_refresh = []

    for s in stocks:
        cached = _price_cache.get(s.ticker)
        if cached and (now - cached['timestamp']) < _cache_ttl:
            result.append({
                'symbol': s.ticker,
                'name': s.company_name,
                'sector': s.sector or 'Technology',
                'price': cached['price'],
                'change': cached['change'],
                'change_pct': cached['change_pct']
            })
        else:
            need_refresh.append(s)

    if need_refresh:
        with ThreadPoolExecutor(max_workers=10) as pool:
            futures = {pool.submit(_fetch_single_quote, s.ticker, float(s.latest_price)): s for s in need_refresh}
            fresh = {}
            for future in as_completed(futures):
                ticker, data = future.result()
                fresh[ticker] = data
                _price_cache[ticker] = {**data, 'timestamp': time.time()}
                s = Stock.query.filter_by(ticker=ticker).first()
                if s and abs(float(s.latest_price) - data['price']) > 0.01:
                    s.latest_price = data['price']
                    db.session.commit()

        for s in need_refresh:
            data = fresh.get(s.ticker, {'price': float(s.latest_price), 'change': 0, 'change_pct': 0})
            result.append({
                'symbol': s.ticker,
                'name': s.company_name,
                'sector': s.sector or 'Technology',
                'price': data['price'],
                'change': data['change'],
                'change_pct': data['change_pct']
            })

    return result

api_bp = Blueprint('api', __name__)

@api_bp.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data or not data.get('username') or not data.get('email') or not data.get('password'):
        return jsonify({'error': 'Missing required fields'}), 400
    if User.query.filter_by(username=data['username']).first():
        return jsonify({'error': 'Username already exists'}), 400
    if User.query.filter_by(email=data['email']).first():
        return jsonify({'error': 'Email already exists'}), 400
    hashed_password = generate_password_hash(data['password'], method='pbkdf2:sha256')
    new_user = User(
        full_name=data.get('full_name'),
        username=data['username'],
        email=data['email'],
        password_hash=hashed_password,
        virtual_balance=10000.00
    )
    db.session.add(new_user)
    db.session.commit()
    portfolio = Portfolio(user_id=new_user.user_id, cash_balance=10000.00)
    db.session.add(portfolio)
    db.session.commit()
    
    return jsonify({
        'message': 'User registered successfully',
        'user_id': new_user.user_id,
        'username': new_user.username,
        'full_name': new_user.full_name,
        'balance': float(new_user.virtual_balance)
    }), 201

from sqlalchemy import or_

@api_bp.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    # Accept 'username' key from frontend but check it against both username and email columns
    identity = data.get('username')
    password = data.get('password')
    
    if not data or not identity or not password:
        return jsonify({'error': 'Missing credentials'}), 400
        
    user = User.query.filter(or_(User.username == identity, User.email == identity)).first()
    
    if not user or not check_password_hash(user.password_hash, password):
        return jsonify({'error': 'Invalid credentials'}), 401
    return jsonify({
        'message': 'Login successful',
        'user_id': user.user_id,
        'username': user.username,
        'full_name': user.full_name,
        'balance': float(user.virtual_balance)
    })

@api_bp.route('/me/<int:user_id>', methods=['GET'])
def get_me(user_id):
    user = db.session.get(User, user_id)
    if user:
        return jsonify({
            'user_id': user.user_id,
            'username': user.username,
            'full_name': user.full_name,
            'balance': float(user.virtual_balance)
        })
    return jsonify({'error': 'Not authenticated'}), 401

@api_bp.route('/stocks', methods=['GET'])
def get_stocks():
    prices = get_all_prices()
    for p in prices:
        p['volume'] = "Real-time"
    return jsonify(prices)

@api_bp.route('/market-movers', methods=['GET'])
def get_market_movers():
    prices = get_all_prices()
    movers = sorted(prices, key=lambda x: x['change_pct'], reverse=True)
    return jsonify({
        'top_gainers': [m for m in movers if m['change_pct'] > 0][:5],
        'top_losers': [m for m in movers if m['change_pct'] < 0][-5:][::-1]
    })

@api_bp.route('/landing', methods=['GET'])
def get_landing_data():
    prices = get_all_prices()
    movers = sorted(prices, key=lambda x: x['change_pct'], reverse=True)
    for p in prices:
        p.pop('sector', None)
    return jsonify({
        'stocks': prices,
        'top_gainers': [m for m in movers if m['change_pct'] > 0][:5],
        'top_losers': [m for m in movers if m['change_pct'] < 0][-5:][::-1]
    })

@api_bp.route('/stocks/<string:ticker>', methods=['GET'])
def get_stock_detail(ticker):
    stock = Stock.query.filter_by(ticker=ticker).first()
    if not stock:
        return jsonify({'error': 'Stock not found'}), 404
    
    range_days = request.args.get('range', default=30, type=int)
    range_days = max(1, min(365, range_days))
        
    try:
        # Fetch real-time data from Finnhub
        quote = finnhub_client.quote(ticker)
        profile = finnhub_client.company_profile2(symbol=ticker)
        
        price = quote.get('c', float(stock.latest_price))
        change = quote.get('d', 0)
        change_pct = quote.get('dp', 0)
        
        # Use profile data if available
        company_name = profile.get('name', stock.company_name)
        sector = profile.get('finnhubIndustry', stock.sector or 'Technology')
        
        # Simulated historical data points for the chart
        base_price = price
        history = []
        now = datetime.now()
        for i in range(range_days - 1, -1, -1):
            day = now - timedelta(days=i)
            h_price = base_price * (1 + (random.random() * 0.1 - 0.05))
            history.append({
                'date': day.strftime('%b %d'),
                'price': round(h_price, 2)
            })
            
        return jsonify({
            'symbol': stock.ticker,
            'name': company_name,
            'sector': sector,
            'price': price,
            'change': change,
            'change_pct': change_pct,
            'volume': 'Real-time',
            '52w_high': quote.get('h', round(price * 1.1, 2)), # Using day high as proxy if 52w not available in free quote
            '52w_low': quote.get('l', round(price * 0.9, 2)),
            'history': history,
            'indicators': {
                'sma20': round(price * 0.98, 2),
                'sma50': round(price * 0.95, 2),
                'rsi': 64.2,
                'volatility': 'Medium'
            }
        })
    except Exception as e:
        print(f"Error fetching Finnhub detail for {ticker}: {e}")
        # Fallback to simulated data if API fails or key is missing
        base_price = float(stock.latest_price)
        return jsonify({
            'symbol': stock.ticker,
            'name': stock.company_name,
            'sector': stock.sector or 'Technology',
            'price': base_price,
            'change': round(base_price * 0.013, 2),
            'change_pct': 1.3,
            'volume': 'Simulated',
            '52w_high': round(base_price * 1.2, 2),
            '52w_low': round(base_price * 0.8, 2),
            'history': [{
                'date': 'N/A',
                'price': 0
            }],
            'indicators': {}
        })


@api_bp.route('/predict/<string:ticker>', methods=['GET'])
def get_stock_prediction(ticker):
    user_id = request.args.get('user_id', type=int)
    range_days = request.args.get('range', default=30, type=int)
    range_days = max(1, min(365, range_days))

    if not user_id:
        return jsonify({'error': 'user_id parameter is required'}), 400

    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404

    stock = Stock.query.filter_by(ticker=ticker).first()
    if not stock:
        return jsonify({'error': 'Stock not found'}), 404

    portfolio = Portfolio.query.filter_by(user_id=user_id).first()
    cash_balance = float(portfolio.cash_balance) if portfolio else float(user.virtual_balance)
    holding = Holding.query.filter_by(user_id=user_id, stock_id=stock.stock_id).first()
    user_holdings = int(holding.quantity) if holding else 0

    # Try multiple ticker symbol variants (e.g., BRK.B -> BRK-B) to handle delisted or alternate symbols
    variants = [ticker, ticker.replace('.', '-'), ticker.replace('.', ''), ticker.replace('.', '/')] if isinstance(ticker, str) else [ticker]
    hist = pd.DataFrame()
    used_symbol = None
    for sym in variants:
        try:
            t_obj = yf.Ticker(sym)
            h = t_obj.history(period=f'{max(range_days, 60)}d')
            if not h.empty and 'Close' in h.columns:
                hist = h
                used_symbol = sym
                break
        except Exception as e:
            # ignore and try next variant
            print(f"Yahoo fetch variant {sym} failed: {e}")

    # If no historical data found, fall back to a synthetic series using DB latest price
    fallback_used = False
    if hist.empty or 'Close' not in hist.columns:
        print(f"No historical data for {ticker} (tried {variants}). Using DB fallback price series.")
        base_price = float(stock.latest_price)
        days = max(range_days, 60)
        dates = pd.date_range(end=pd.Timestamp.today(), periods=days)
        hist = pd.DataFrame({'Close': [base_price] * days}, index=dates)
        fallback_used = True

    close_prices = hist['Close'].dropna().astype(float).values
    if len(close_prices) == 0:
        return jsonify({'error': 'No valid close prices found'}), 404

    try:
        quote = finnhub_client.quote(ticker)
        current_price = float(quote.get('c', close_prices[-1]))
        change = float(quote.get('d', 0))
        change_pct = float(quote.get('dp', 0))
        volume_val = quote.get('v', 'Real-time')
    except Exception as e:
        print(f"Finnhub quote failed for {ticker}: {e}")
        current_price = float(close_prices[-1])
        change = 0.0
        change_pct = 0.0
        volume_val = 'Real-time'

    current_price = max(current_price, 0.01)
    rsi_value = calculate_rsi(close_prices)

    history_prices = close_prices[-range_days:]
    history = []
    for i, price in enumerate(history_prices):
        history.append({
            'date': hist.index[-range_days + i].strftime('%b %d'),
            'price': float(price)
        })

    try:
        profile = finnhub_client.company_profile2(symbol=ticker)
    except Exception:
        profile = {}

    company_name = profile.get('name', stock.company_name)
    sector = profile.get('finnhubIndustry', stock.sector or 'Technology')

    recommendation_result = get_ensemble_recommendation(
        ticker_symbol=ticker,
        user_cash=cash_balance,
        user_holdings=user_holdings,
        historical_data=hist,
        live_price=current_price,
        fallback_used=fallback_used
    )

    if 'error' in recommendation_result:
        return jsonify({'error': recommendation_result['error']}), 500
    # Safely extract fields from recommendation_result (handle non-dict return types)
    def _safe_get(obj, key, default=None):
        try:
            if isinstance(obj, dict):
                return obj.get(key, default)
            return getattr(obj, key, obj.get(key, default) if hasattr(obj, 'get') else default)
        except Exception:
            try:
                return obj[key]
            except Exception:
                return default

    predicted_price_5d = float(_safe_get(recommendation_result, 'predicted_price_5d', 0.0))
    recommendation = _safe_get(recommendation_result, 'recommendation')
    action = _safe_get(recommendation_result, 'action')
    suggested_qty = int(_safe_get(recommendation_result, 'suggested_qty', _safe_get(recommendation_result, 'suggested_shares', 0) or 0))
    # Backwards-compat: some callers used 'suggested_shares'
    suggested_shares_alias = suggested_qty
    reason = _safe_get(recommendation_result, 'reason')
    confidence = int(_safe_get(recommendation_result, 'confidence', 0) or 0)
    fallback_flag = bool(_safe_get(recommendation_result, 'fallback_used', False))
    macd_signal = float(_safe_get(recommendation_result, 'macd_signal', 0.0) or 0.0)
    forecast_series = _safe_get(recommendation_result, 'forecast_series', [])
    price_change_pct = ((predicted_price_5d - current_price) / current_price) * 100.0

    return jsonify({
        'symbol': stock.ticker,
        'name': company_name,
        'sector': sector,
        'price': float(current_price),
        'change': float(change),
        'change_pct': float(change_pct),
        'volume': volume_val,
        '52w_high': float(np.max(close_prices)),
        '52w_low': float(np.min(close_prices)),
        'history': history,
        'indicators': {
            'sma20': float(np.mean(close_prices[-20:])) if len(close_prices) >= 20 else float(np.mean(close_prices)),
            'sma50': float(np.mean(close_prices[-50:])) if len(close_prices) >= 50 else float(np.mean(close_prices)),
            'rsi': float(rsi_value),
            'volatility': 'Medium'
        },
        'current_price': float(current_price),
        'predicted_price_5d': predicted_price_5d,
        'rsi': float(rsi_value),
        'recommendation': recommendation,
        'action': action,
        'suggested_qty': suggested_qty,
        'suggested_shares': suggested_shares_alias,
        'macd_signal': macd_signal,
        'reason': reason,
        'confidence': confidence,
        'fallback_used': fallback_flag,
        'forecast_series': forecast_series,
        'predicted_change_pct': float(price_change_pct)
    })


@api_bp.route('/portfolio/<int:user_id>', methods=['GET'])
def get_portfolio(user_id):
    holdings = Holding.query.filter_by(user_id=user_id).all()
    return jsonify([{
        'symbol': h.stock.ticker,
        'company': h.stock.company_name,
        'quantity': h.quantity,
        'avg_price': float(h.avg_buy_price),
        'current_price': _get_cached_price(h.stock.ticker, float(h.stock.latest_price))
    } for h in holdings])

@api_bp.route('/dashboard-summary/<int:user_id>', methods=['GET'])
def get_dashboard_summary(user_id):
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
        
    holdings = Holding.query.filter_by(user_id=user_id).all()
    total_holdings_value = sum([float(h.quantity) * _get_cached_price(h.stock.ticker, float(h.stock.latest_price)) for h in holdings])
    portfolio_value = float(user.virtual_balance) + total_holdings_value
    
    # Simple total return calculation (Portfolio Value - Initial $10,000)
    # In a real app, this would use total_invested from Portfolio model
    initial_balance = 10000.00
    total_return = portfolio_value - initial_balance
    total_return_pct = (total_return / initial_balance) * 100 if initial_balance > 0 else 0
    
    trade_count = Transaction.query.filter_by(user_id=user_id).count()
    
    return jsonify({
        'virtual_balance': float(user.virtual_balance),
        'portfolio_value': portfolio_value,
        'total_return': total_return,
        'total_return_pct': total_return_pct,
        'total_trades': trade_count
    })

@api_bp.route('/transactions/<int:user_id>', methods=['GET'])
def get_transactions(user_id):
    transactions = Transaction.query.filter_by(user_id=user_id).order_by(Transaction.timestamp.desc()).all()
    return jsonify([{
        'symbol': t.stock.ticker,
        'company': t.stock.company_name,
        'type': t.trade_type,
        'quantity': t.quantity,
        'price': float(t.price_at_trade),
        'total': float(t.total_amount),
        'gain_loss': float(t.gain_loss or 0),
        'current_price': _get_cached_price(t.stock.ticker, float(t.stock.latest_price)),
        'timestamp': t.timestamp.strftime('%Y-%m-%d %H:%M')
    } for t in transactions])

@api_bp.route('/trade', methods=['POST'])
def execute_trade():
    data = request.get_json()
    user_id = data.get('user_id')
    ticker = data.get('ticker')
    trade_type = data.get('trade_type') # 'BUY' or 'SELL'
    quantity = int(data.get('quantity', 0))
    
    if not all([user_id, ticker, trade_type, quantity > 0]):
        return jsonify({'error': 'Missing or invalid trade data'}), 400
        
    user = db.session.get(User, user_id)
    stock = Stock.query.filter_by(ticker=ticker).first()
    
    if not user or not stock:
        return jsonify({'error': 'User or Stock not found'}), 404
        
    price = float(stock.latest_price)
    total_cost = price * quantity
    
    if trade_type == 'BUY':
        if float(user.virtual_balance) < total_cost:
            return jsonify({'error': 'Insufficient balance'}), 400
            
        user.virtual_balance = float(user.virtual_balance) - total_cost
        
        holding = Holding.query.filter_by(user_id=user_id, stock_id=stock.stock_id).first()
        if holding:
            # Update average price: (old_qty * old_avg + new_qty * price) / total_qty
            total_qty = holding.quantity + quantity
            new_avg = (float(holding.quantity) * float(holding.avg_buy_price) + total_cost) / total_qty
            holding.quantity = total_qty
            holding.avg_buy_price = new_avg
        else:
            holding = Holding(user_id=user_id, stock_id=stock.stock_id, quantity=quantity, avg_buy_price=price)
            db.session.add(holding)
        gain_loss = 0
            
    elif trade_type == 'SELL':
        holding = Holding.query.filter_by(user_id=user_id, stock_id=stock.stock_id).first()
        if not holding or holding.quantity < quantity:
            return jsonify({'error': 'Insufficient shares to sell'}), 400
            
        # Calculate Realized G/L: (Sale Price - Avg Buy Price) * Quantity
        gain_loss = (price - float(holding.avg_buy_price)) * quantity
        
        user.virtual_balance = float(user.virtual_balance) + total_cost
        holding.quantity -= quantity
        
        if holding.quantity == 0:
            db.session.delete(holding)
            
    # Record transaction
    transaction = Transaction(
        user_id=user_id,
        stock_id=stock.stock_id,
        trade_type=trade_type,
        quantity=quantity,
        price_at_trade=price,
        total_amount=total_cost,
        gain_loss=gain_loss
    )
    
    if trade_type == 'SELL':
        # Re-fetch or use local avg_buy_price to calculate realized G/L
        # Note: 'holding' was already modified (decremented). 
        # For accurate G/L we need the avg_price at the time of sale.
        # This belongs inside the SELL block for better precision, but let's adjust it here.
        pass

    db.session.add(transaction)
    db.session.commit()
    
    return jsonify({
        'message': f'Successfully {trade_type.lower()}ed {quantity} shares of {ticker}',
        'new_balance': float(user.virtual_balance)
    })

@api_bp.route('/user/update/<int:user_id>', methods=['PUT'])
def update_profile(user_id):
    data = request.get_json()
    user = db.session.get(User, user_id)
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
        
    if data.get('username') and data['username'] != user.username:
        if User.query.filter_by(username=data['username']).first():
            return jsonify({'error': 'Username already taken'}), 400
        user.username = data['username']
        
    if data.get('email') and data['email'] != user.email:
        if User.query.filter_by(email=data['email']).first():
            return jsonify({'error': 'Email already taken'}), 400
        user.email = data['email']
        
    if data.get('full_name'):
        user.full_name = data['full_name']
        
    db.session.commit()
    
    return jsonify({
        'message': 'Profile updated successfully',
        'user_id': user.user_id,
        'username': user.username,
        'full_name': user.full_name,
        'balance': float(user.virtual_balance)
    })

@api_bp.route('/user/update-password/<int:user_id>', methods=['PUT'])
def update_password(user_id):
    data = request.get_json()
    user = db.session.get(User, user_id)
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
        
    current_password = data.get('current_password')
    new_password = data.get('new_password')
    
    if not current_password or not new_password:
        return jsonify({'error': 'Missing required fields'}), 400
        
    if not check_password_hash(user.password_hash, current_password):
        return jsonify({'error': 'Incorrect current password'}), 401
        
    user.password_hash = generate_password_hash(new_password, method='pbkdf2:sha256')
    db.session.commit()
    
    return jsonify({'message': 'Password updated successfully'})

@api_bp.route('/user/delete/<int:user_id>', methods=['DELETE'])
def delete_account(user_id):
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
        
    # Delete associated data first (SQLAlchemy handles this if cascade is set, but better safe)
    # Portfolio, holdings, transactions are linked to user_id
    from models import Portfolio, Holding, Transaction
    Portfolio.query.filter_by(user_id=user_id).delete()
    Holding.query.filter_by(user_id=user_id).delete()
    Transaction.query.filter_by(user_id=user_id).delete()
    
    db.session.delete(user)
    db.session.commit()
    
    return jsonify({'message': 'Account deleted successfully'})

@api_bp.route('/leaderboard', methods=['GET'])
def get_leaderboard():
    users = User.query.all()
    leaderboard = []
    
    for user in users:
        # Calculate current holdings value
        holdings = Holding.query.filter_by(user_id=user.user_id).all()
        holdings_value = sum([float(h.quantity) * float(h.stock.latest_price) for h in holdings])
        portfolio_value = float(user.virtual_balance) + holdings_value
        
        # Calculate returns
        initial_balance = 10000.00
        total_return = portfolio_value - initial_balance
        total_return_pct = (total_return / initial_balance) * 100 if initial_balance > 0 else 0
        
        trade_count = Transaction.query.filter_by(user_id=user.user_id).count()
        
        leaderboard.append({
            'user_id': user.user_id,
            'username': user.username,
            'full_name': user.full_name,
            'portfolio_value': portfolio_value,
            'total_return': total_return,
            'return_pct': total_return_pct,
            'trades': trade_count
        })
    
    # Sort by return_pct descending
    leaderboard.sort(key=lambda x: x['return_pct'], reverse=True)
    
    return jsonify(leaderboard)

@api_bp.route('/market-news', methods=['GET'])
def get_market_news():
    category = request.args.get('category', 'general')
    try:
        news = finnhub_client.general_news(category, min_id=0)
        result = []
        for article in news[:10]:
            result.append({
                'id': article.get('id'),
                'headline': article.get('headline'),
                'summary': article.get('summary'),
                'url': article.get('url'),
                'image': article.get('image'),
                'source': article.get('source'),
                'datetime': article.get('datetime'),
                'category': article.get('category'),
                'related': article.get('related')
            })
        return jsonify(result)
    except Exception as e:
        print(f"Error fetching market news: {e}")
        return jsonify([])

@api_bp.route('/stocks/search', methods=['GET'])
def search_stocks():
    query = request.args.get('q', '')
    if not query:
        return jsonify([])
        
    try:
        # Use Finnhub symbol lookup
        search_results = finnhub_client.symbol_lookup(query)
        results = []
        for item in search_results.get('result', []):
            ticker = item.get('symbol')
            # Check if we already have it
            stock = Stock.query.filter_by(ticker=ticker).first()
            if not stock:
                # Add it to our DB automatically if searched (or just return the info)
                # For this platform, let's auto-add so users can trade immediately
                try:
                    quote = finnhub_client.quote(ticker)
                    if quote.get('c'): # Ensure it has a price
                        new_stock = Stock(
                            ticker=ticker,
                            company_name=item.get('description', ticker),
                            latest_price=quote.get('c'),
                            sector='Technology' # Default or fetch from profile if needed
                        )
                        db.session.add(new_stock)
                        db.session.commit()
                        stock = new_stock
                except Exception:
                    continue # Skip if price fetch fails

            if stock:
                results.append({
                    'symbol': stock.ticker,
                    'name': stock.company_name,
                    'price': float(stock.latest_price)
                })
        return jsonify(results)
    except Exception as e:
        print(f"Search error: {e}")
        return jsonify([])
