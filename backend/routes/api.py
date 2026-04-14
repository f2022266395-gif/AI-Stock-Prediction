from flask import Blueprint, jsonify, request
from models import db, User, Stock, Portfolio, Holding
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

@api_bp.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data or not data.get('username') or not data.get('password'):
        return jsonify({'error': 'Missing username or password'}), 400
    user = User.query.filter_by(username=data['username']).first()
    if not user or not check_password_hash(user.password_hash, data['password']):
        return jsonify({'error': 'Invalid username or password'}), 401
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
