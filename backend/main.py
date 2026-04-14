from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from models import db, User, Stock, Portfolio, Transaction, Holding, PriceHistory, Badge
import os
from decimal import Decimal

app = Flask(__name__, static_folder='../frontend')
CORS(app)

# Database Configuration
basedir = os.path.abspath(os.path.dirname(__file__))
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, 'stock_sim.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db.init_app(app)

# Initialize Database
with app.app_context():
    db.create_all()
    
    # Add some mock stocks if the table is empty
    if Stock.query.count() == 0:
        stocks = [
            Stock(ticker='AAPL', company_name='Apple Inc.', latest_price=175.50, sector='Technology'),
            Stock(ticker='GOOGL', company_name='Alphabet Inc.', latest_price=140.20, sector='Technology'),
            Stock(ticker='TSLA', company_name='Tesla, Inc.', latest_price=240.10, sector='Automotive'),
            Stock(ticker='MSFT', company_name='Microsoft Corporation', latest_price=330.40, sector='Technology'),
            Stock(ticker='AMZN', company_name='Amazon.com, Inc.', latest_price=135.60, sector='Consumer Cyclical')
        ]
        db.session.bulk_save_objects(stocks)
        
    # Add a mock user if empty
    if User.query.count() == 0:
        user = User(
            username='trader1', 
            email='trader@example.com', 
            password_hash='hashed_pass', 
            virtual_balance=10000.00
        )
        db.session.add(user)
        db.session.commit()
        
        # Initialize Portfolio for the user
        portfolio = Portfolio(user_id=user.user_id, cash_balance=10000.00)
        db.session.add(portfolio)
    
    db.session.commit()

# --- API Routes ---

@app.route('/api/stocks', methods=['GET'])
def get_stocks():
    stocks = Stock.query.all()
    return jsonify([{
        'symbol': s.ticker, # Keeping key names same for frontend compatibility where possible
        'name': s.company_name,
        'price': float(s.latest_price)
    } for s in stocks])

@app.route('/api/portfolio/<int:user_id>', methods=['GET'])
def get_portfolio(user_id):
    holdings = Holding.query.filter_by(user_id=user_id).all()
    return jsonify([{
        'symbol': h.stock.ticker,
        'quantity': h.quantity,
        'avg_price': float(h.avg_buy_price)
    } for h in holdings])

@app.route('/api/user/<int:user_id>', methods=['GET'])
def get_user(user_id):
    user = db.session.get(User, user_id)
    if user:
        return jsonify({
            'username': user.username,
            'balance': float(user.virtual_balance)
        })
    return jsonify({'error': 'User not found'}), 404

# Serve Frontend
@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/<path:path>')
def static_proxy(path):
    return send_from_directory(app.static_folder, path)

if __name__ == '__main__':
    app.run(debug=True, port=5000)
