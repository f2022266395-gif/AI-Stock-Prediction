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
    return jsonify([{
        'symbol': s.ticker,
        'name': s.company_name,
        'price': float(s.latest_price)
    } for s in stocks])

@api_bp.route('/portfolio/<int:user_id>', methods=['GET'])
def get_portfolio(user_id):
    holdings = Holding.query.filter_by(user_id=user_id).all()
    return jsonify([{
        'symbol': h.stock.ticker,
        'quantity': h.quantity,
        'avg_price': float(h.avg_buy_price)
    } for h in holdings])

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
