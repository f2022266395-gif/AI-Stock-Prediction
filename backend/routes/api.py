import os
import threading
from dotenv import load_dotenv

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ENV_PATH = os.path.join(BASE_DIR, '.env')
load_dotenv(ENV_PATH, override=True)

def _get_finnhub_api_key():
    api_key = os.getenv('FINNHUB_API_KEY', '').strip()
    if not api_key:
        raise RuntimeError('FINNHUB_API_KEY is not configured in .env or environment.')
    return api_key

FINNHUB_API_KEY = _get_finnhub_api_key()
print(f"DEBUG: Loaded FINNHUB_API_KEY prefix={FINNHUB_API_KEY[:4]}... len={len(FINNHUB_API_KEY)}")

from flask import Blueprint, jsonify, request
from models import db, User, Stock, Portfolio, Holding, Transaction
from werkzeug.security import generate_password_hash, check_password_hash
import finnhub
import yfinance as yf
from config import Config
from datetime import datetime, timedelta

try:
    import numpy as np
except ImportError:
    np = None

try:
    import torch
except ImportError:
    torch = None

try:
    if torch is None:
        raise ImportError("torch is not installed.")
    from chronos import ChronosPipeline
except ImportError:
    ChronosPipeline = None

# Use request-local Finnhub client so the latest FINNHUB_API_KEY is always loaded from environment.
api_bp = Blueprint('api', __name__)
PREDICTION_CACHE = {}
PREDICTION_IN_PROGRESS = set()
PREDICTION_LOCK = threading.Lock()

# Load the time-series model once at startup so requests only run inference.
chronos_pipeline = None
chronos_load_error = None
if ChronosPipeline is None:
    chronos_load_error = "chronos-forecasting and torch must be installed."
elif np is None:
    chronos_load_error = "numpy must be installed."
else:
    try:
        chronos_pipeline = ChronosPipeline.from_pretrained(
            "amazon/chronos-t5-base",
            device_map="cpu",
            torch_dtype=torch.bfloat16,
        )
    except Exception as exc:
        chronos_load_error = str(exc)


def _build_market_outlook(recommendation, ticker, company_name, percentage_move, ai_low, ai_median, ai_high):
    if recommendation == "BUY":
        narrative = (
            "The Chronos time-series distribution is leaning above the live price, "
            "indicating strong upward breakout momentum that is testing upper "
            "historical resistance lines."
        )
    elif recommendation == "SELL":
        narrative = (
            "The Chronos time-series distribution is leaning below the live price, "
            "showing a downward geometric trajectory that mimics previous "
            "historical sell-off baselines."
        )
    else:
        narrative = (
            "The Chronos time-series distribution is clustered near the live price, "
            "suggesting a stabilization phase with tight horizontal trend behavior "
            "and low immediate volatility."
        )

    return (
        f"{company_name} ({ticker}) receives a {recommendation} rating from the "
        f"backend rule engine. The 5-day AI median target is ${ai_median:.2f}, "
        f"with a low volatility boundary of ${ai_low:.2f} and a high volatility "
        f"boundary of ${ai_high:.2f}. This implies a projected move of "
        f"{percentage_move:.2f}% from the current live quote. {narrative}"
    )


def _get_finnhub_client():
    api_key = _get_finnhub_api_key()
    return finnhub.Client(api_key=api_key)


def _fetch_finnhub_profile(ticker):
    try:
        client = _get_finnhub_client()
        return client.company_profile2(symbol=ticker) or {}
    except Exception as exc:
        print(f"WARNING: Finnhub profile fetch failed for {ticker}: {exc}")
        return {}


def _fetch_finnhub_quote(ticker):
    try:
        client = _get_finnhub_client()
        quote = client.quote(ticker) or {}
        current_price = float(quote.get('c') or 0)
        return current_price, quote
    except Exception as exc:
        print(f"WARNING: Finnhub quote fetch failed for {ticker}: {exc}")
        return 0, {}


def _fallback_current_price(ticker):
    try:
        stock = Stock.query.filter_by(ticker=ticker).first()
        if stock and stock.latest_price and float(stock.latest_price) > 0:
            return float(stock.latest_price)
    except Exception:
        pass

    try:
        recent = yf.Ticker(ticker).history(period='5d')
        if not recent.empty:
            latest = recent['Close'].dropna().tolist()
            if latest:
                return float(latest[-1])
    except Exception as exc:
        print(f"WARNING: yfinance fallback price fetch failed for {ticker}: {exc}")

    return 0


def _build_prediction_response(ticker, company_name, industry, market_cap, current_price, ai_low, ai_median, ai_high, percentage_move, recommendation, recommendation_color):
    return {
        'status': 'success',
        'company_name': company_name,
        'industry': industry,
        'market_cap': market_cap,
        'current_price': round(current_price, 2),
        'ai_high_range': round(ai_high, 2),
        'ai_low_range': round(ai_low, 2),
        'ai_median_target': round(ai_median, 2),
        'percentage_move': round(percentage_move, 2),
        'recommendation': recommendation,
        'recommendation_color': recommendation_color,
        'market_outlook': _build_market_outlook(
            recommendation,
            ticker,
            company_name,
            percentage_move,
            ai_low,
            ai_median,
            ai_high,
        )
    }


def _generate_prediction(ticker, company_name, industry, market_cap, current_price):
    try:
        historical_prices = []
        try:
            yf_history = yf.Ticker(ticker).history(period='1y')
            historical_prices = [
                float(price)
                for price in yf_history['Close'].dropna().tolist()
                if price is not None and float(price) > 0
            ]
            if not historical_prices:
                raise ValueError('No valid close prices returned from yfinance')
        except Exception as yfe:
            print(f"WARNING: yfinance history fetch failed for {ticker}: {yfe}")
            now = datetime.utcnow()
            end_time = int(now.timestamp())
            start_time = int((now - timedelta(days=500)).timestamp())
            client = _get_finnhub_client()
            candles = client.stock_candles(ticker, 'D', start_time, end_time) or {}
            if candles.get('s') == 'ok' and candles.get('c'):
                historical_prices = [
                    float(price)
                    for price in candles.get('c', [])
                    if price is not None and float(price) > 0
                ]
            else:
                raise RuntimeError(f'No historical data returned for {ticker}')

        context = torch.tensor(historical_prices, dtype=torch.float32)
        forecast = chronos_pipeline.predict(context, prediction_length=5)
        forecast_array = forecast.detach().cpu().numpy() if hasattr(forecast, 'detach') else np.asarray(forecast)
        series_samples = forecast_array[0] if getattr(forecast_array, 'ndim', 0) == 3 else forecast_array

        low_path, median_path, high_path = np.percentile(series_samples, [10, 50, 90], axis=0)
        ai_low = float(low_path[-1])
        ai_median = float(median_path[-1])
        ai_high = float(high_path[-1])

        percentage_move = ((ai_median - current_price) / current_price) * 100 if current_price else 0
        if percentage_move > 1.5:
            recommendation = 'BUY'
            recommendation_color = '#2ecc71'
        elif percentage_move < -1.5:
            recommendation = 'SELL'
            recommendation_color = '#e74c3c'
        else:
            recommendation = 'HOLD'
            recommendation_color = '#f1c40f'

        prediction_response = _build_prediction_response(
            ticker,
            company_name,
            industry,
            market_cap,
            current_price,
            ai_low,
            ai_median,
            ai_high,
            percentage_move,
            recommendation,
            recommendation_color,
        )

        with PREDICTION_LOCK:
            PREDICTION_CACHE[ticker] = prediction_response
    except Exception as exc:
        print(f"Prediction background generation failed for {ticker}: {exc}")
    finally:
        with PREDICTION_LOCK:
            PREDICTION_IN_PROGRESS.discard(ticker)


@api_bp.route('/predict', methods=['GET'])
def predict_stock():
    ticker = request.args.get('ticker', '').strip().upper()
    if not ticker:
        return jsonify({'status': 'error', 'error': 'Ticker parameter is required'}), 400

    if not FINNHUB_API_KEY:
        return jsonify({'status': 'error', 'error': 'Finnhub API key is not configured'}), 500

    if chronos_pipeline is None:
        return jsonify({
            'status': 'error',
            'error': 'Chronos model is unavailable',
            'details': chronos_load_error
        }), 503

    try:
        with PREDICTION_LOCK:
            if ticker in PREDICTION_CACHE:
                return jsonify(PREDICTION_CACHE[ticker])
            if ticker in PREDICTION_IN_PROGRESS:
                processing_response = {
                    'status': 'processing',
                    'market_outlook': 'Awaiting prediction generation...',
                }
                return jsonify(processing_response), 202

        profile = _fetch_finnhub_profile(ticker)
        company_name = profile.get('name') or ticker
        industry = profile.get('finnhubIndustry') or 'Unknown'
        market_cap = profile.get('marketCapitalization') or 0

        current_price, quote = _fetch_finnhub_quote(ticker)
        if current_price <= 0:
            current_price = _fallback_current_price(ticker)

        if current_price <= 0:
            return jsonify({
                'status': 'error',
                'error': f'No live quote returned for {ticker}'
            }), 404

        with PREDICTION_LOCK:
            if ticker in PREDICTION_CACHE:
                return jsonify(PREDICTION_CACHE[ticker])
            if ticker in PREDICTION_IN_PROGRESS:
                processing_response = {
                    'status': 'processing',
                    'market_outlook': 'Awaiting prediction generation...',
                    'company_name': company_name,
                    'industry': industry,
                    'market_cap': market_cap,
                    'current_price': round(current_price, 2)
                }
                return jsonify(processing_response), 202
            PREDICTION_IN_PROGRESS.add(ticker)

        thread = threading.Thread(
            target=_generate_prediction,
            args=(ticker, company_name, industry, market_cap, current_price),
            daemon=True
        )
        thread.start()

        processing_response = {
            'status': 'processing',
            'market_outlook': 'Awaiting prediction generation...',
            'company_name': company_name,
            'industry': industry,
            'market_cap': market_cap,
            'current_price': round(current_price, 2)
        }
        return jsonify(processing_response), 202
    except Exception as exc:
        print(f"Prediction error for {ticker}: {exc}")
        return jsonify({
            'status': 'error',
            'error': 'Prediction request failed',
            'details': str(exc)
        }), 500

@api_bp.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data or not data.get('username') or not data.get('email') or not data.get('password'):
        return jsonify({'error': 'Missing required fields'}), 400
    if User.query.filter_by(username=data['username']).first():
        return jsonify({'error': 'Username already exists'}), 400
    if User.query.filter_by(email=data['email']).first():
        return jsonify({'error': 'Email already exists'}), 400
    hashed_password = generate_password_hash(data['password'])
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
    stocks = Stock.query.all()
    result = []
    for s in stocks:
        try:
            print(f"DEBUG: Fetching real-time quote for {s.ticker}...")
            price, quote = _fetch_finnhub_quote(s.ticker)
            if price <= 0:
                print(f"WARNING: Finnhub quote unavailable for {s.ticker}. Using stored price.")
                price = float(s.latest_price)
                change = 0
                change_pct = 0
            else:
                change = quote.get('d', 0)
                change_pct = quote.get('dp', 0)
                print(f"SUCCESS: {s.ticker} | Price: ${price} | Change: ${change} ({change_pct}%)")

            if abs(float(s.latest_price) - price) > 0.01:
                s.latest_price = price
                db.session.commit()
        except Exception as e:
            print(f"ERROR: Finnhub API failure for {s.ticker}: {e}")
            price = float(s.latest_price)
            change = 0
            change_pct = 0

        result.append({
            'symbol': s.ticker,
            'name': s.company_name,
            'sector': s.sector or 'Technology',
            'price': price,
            'change': change,
            'change_pct': change_pct,
            'volume': "Real-time"
        })
    return jsonify(result)

@api_bp.route('/stocks/<string:ticker>', methods=['GET'])
def get_stock_detail(ticker):
    stock = Stock.query.filter_by(ticker=ticker).first()
    if not stock:
        return jsonify({'error': 'Stock not found'}), 404
        
    try:
        price, quote = _fetch_finnhub_quote(ticker)
        profile = _fetch_finnhub_profile(ticker)

        if price <= 0:
            print(f"WARNING: Finnhub fallback price used for {ticker}.")
            price = float(stock.latest_price)
            change = 0
            change_pct = 0
        else:
            change = quote.get('d', 0)
            change_pct = quote.get('dp', 0)

        company_name = profile.get('name', stock.company_name)
        sector = profile.get('finnhubIndustry', stock.sector or 'Technology')

        base_price = price
        history = []
        import random
        for i in range(30, -1, -1):
            h_price = base_price * (1 + (random.random() * 0.1 - 0.05))
            history.append({
                'date': f'Mar {31-i if 31-i > 0 else 30}',
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
            'history': [],
            'indicators': {}
        })

@api_bp.route('/portfolio/<int:user_id>', methods=['GET'])
def get_portfolio(user_id):
    holdings = Holding.query.filter_by(user_id=user_id).all()
    return jsonify([{
        'symbol': h.stock.ticker,
        'quantity': h.quantity,
        'avg_price': float(h.avg_buy_price),
        'current_price': float(h.stock.latest_price)
    } for h in holdings])

@api_bp.route('/dashboard-summary/<int:user_id>', methods=['GET'])
def get_dashboard_summary(user_id):
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
        
    holdings = Holding.query.filter_by(user_id=user_id).all()
    total_holdings_value = sum([float(h.quantity) * float(h.stock.latest_price) for h in holdings])
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
        
    user.password_hash = generate_password_hash(new_password)
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

@api_bp.route('/stocks/search', methods=['GET'])
def search_stocks():
    query = request.args.get('q', '')
    if not query:
        return jsonify([])
        
    try:
        # Use Finnhub symbol lookup
        client = _get_finnhub_client()
        search_results = client.symbol_lookup(query)
        results = []
        for item in search_results.get('result', []):
            ticker = item.get('symbol')
            # Check if we already have it
            stock = Stock.query.filter_by(ticker=ticker).first()
            if not stock:
                # Add it to our DB automatically if searched (or just return the info)
                # For this platform, let's auto-add so users can trade immediately
                try:
                    quote = client.quote(ticker)
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
