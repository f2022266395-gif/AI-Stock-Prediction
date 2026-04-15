from flask import Blueprint, jsonify, request
from models import db, User, Stock, Portfolio, Holding, Transaction
from werkzeug.security import generate_password_hash, check_password_hash

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
    return jsonify({'message': 'User registered successfully', 'user_id': new_user.user_id}), 201

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
        # Simulated data for visual completeness
        change = (float(s.latest_price) * 0.015) # Simulated 1.5% change
        change_pct = 1.5
        volume = "52.4M"
        result.append({
            'symbol': s.ticker,
            'name': s.company_name,
            'sector': s.sector or 'Technology',
            'price': float(s.latest_price),
            'change': change,
            'change_pct': change_pct,
            'volume': volume
        })
    return jsonify(result)

@api_bp.route('/stocks/<string:ticker>', methods=['GET'])
def get_stock_detail(ticker):
    stock = Stock.query.filter_by(ticker=ticker).first()
    if not stock:
        return jsonify({'error': 'Stock not found'}), 404
        
    # Simulated historical data points for the chart
    base_price = float(stock.latest_price)
    history = []
    import random
    for i in range(30, -1, -1):
        price = base_price * (1 + (random.random() * 0.1 - 0.05))
        history.append({
            'date': f'Mar {31-i if 31-i > 0 else 30}',
            'price': round(price, 2)
        })
        
    return jsonify({
        'symbol': stock.ticker,
        'name': stock.company_name,
        'sector': stock.sector or 'Technology',
        'price': base_price,
        'change': round(base_price * 0.013, 2),
        'change_pct': 1.3,
        'volume': '48.2M',
        '52w_high': round(base_price * 1.2, 2),
        '52w_low': round(base_price * 0.8, 2),
        'history': history,
        'indicators': {
            'sma20': round(base_price * 0.98, 2),
            'sma50': round(base_price * 0.95, 2),
            'rsi': 64.2,
            'volatility': 'Medium'
        }
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
    transactions = Transaction.query.filter_by(user_id=user_id).order_by(Transaction.timestamp.desc()).limit(10).all()
    return jsonify([{
        'symbol': t.stock.ticker,
        'type': t.trade_type,
        'quantity': t.quantity,
        'price': float(t.price_at_trade),
        'total': float(t.total_amount),
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
            
    elif trade_type == 'SELL':
        holding = Holding.query.filter_by(user_id=user_id, stock_id=stock.stock_id).first()
        if not holding or holding.quantity < quantity:
            return jsonify({'error': 'Insufficient shares to sell'}), 400
            
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
        total_amount=total_cost
    )
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
