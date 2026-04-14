from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()

class User(db.Model):
    __tablename__ = 'users'
    user_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    full_name = db.Column(db.String(100))
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(200), nullable=False)
    virtual_balance = db.Column(db.Numeric(15, 2), default=10000.00)
    role = db.Column(db.String(10), default='user')  # 'user' or 'admin'
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    portfolio = db.relationship('Portfolio', backref='user', uselist=False)
    holdings = db.relationship('Holding', backref='user', lazy=True)
    transactions = db.relationship('Transaction', backref='user', lazy=True)
    badges = db.relationship('Badge', backref='user', lazy=True)

class Stock(db.Model):
    __tablename__ = 'stocks'
    stock_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    ticker = db.Column(db.String(10), unique=True, nullable=False)
    company_name = db.Column(db.String(100), nullable=False)
    sector = db.Column(db.String(50))
    latest_price = db.Column(db.Numeric(15, 2), nullable=False)
    last_updated = db.Column(db.DateTime, default=datetime.utcnow)
    
    price_history = db.relationship('PriceHistory', backref='stock', lazy=True)
    holdings = db.relationship('Holding', backref='stock', lazy=True)
    transactions = db.relationship('Transaction', backref='stock', lazy=True)

class PriceHistory(db.Model):
    __tablename__ = 'price_history'
    price_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    stock_id = db.Column(db.Integer, db.ForeignKey('stocks.stock_id'), nullable=False)
    trade_date = db.Column(db.Date, nullable=False)
    open_price = db.Column(db.Numeric(15, 2), nullable=False)
    high_price = db.Column(db.Numeric(15, 2), nullable=False)
    low_price = db.Column(db.Numeric(15, 2), nullable=False)
    close_price = db.Column(db.Numeric(15, 2), nullable=False)
    volume = db.Column(db.BigInteger, nullable=False)

class Portfolio(db.Model):
    __tablename__ = 'portfolios'
    portfolio_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.user_id'), unique=True, nullable=False)
    total_value = db.Column(db.Numeric(15, 2), default=0.00)
    cash_balance = db.Column(db.Numeric(15, 2), default=10000.00)
    total_invested = db.Column(db.Numeric(15, 2), default=0.00)
    total_return_pct = db.Column(db.Numeric(10, 4), default=0.00)
    last_updated = db.Column(db.DateTime, default=datetime.utcnow)

class Holding(db.Model):
    __tablename__ = 'holdings'
    holding_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.user_id'), nullable=False)
    stock_id = db.Column(db.Integer, db.ForeignKey('stocks.stock_id'), nullable=False)
    quantity = db.Column(db.Integer, nullable=False)
    avg_buy_price = db.Column(db.Numeric(15, 2), nullable=False)
    current_value = db.Column(db.Numeric(15, 2), default=0.00)
    last_updated = db.Column(db.DateTime, default=datetime.utcnow)
    
    __table_args__ = (db.UniqueConstraint('user_id', 'stock_id', name='_user_stock_uc'),)

class Transaction(db.Model):
    __tablename__ = 'transactions'
    trade_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.user_id'), nullable=False)
    stock_id = db.Column(db.Integer, db.ForeignKey('stocks.stock_id'), nullable=False)
    trade_type = db.Column(db.String(4), nullable=False)  # 'BUY' or 'SELL'
    quantity = db.Column(db.Integer, nullable=False)
    price_at_trade = db.Column(db.Numeric(15, 2), nullable=False)
    total_amount = db.Column(db.Numeric(15, 2), nullable=False)
    gain_loss = db.Column(db.Numeric(15, 2), default=0.00)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

class Badge(db.Model):
    __tablename__ = 'badges'
    badge_id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.user_id'), nullable=False)
    badge_name = db.Column(db.String(50), nullable=False)
    description = db.Column(db.String(200))
    awarded_at = db.Column(db.DateTime, default=datetime.utcnow)
