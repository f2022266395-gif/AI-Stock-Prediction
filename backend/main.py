from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from models import db, User, Stock, Portfolio, Transaction
import os

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
            Stock(symbol='AAPL', name='Apple Inc.', current_price=175.50),
            Stock(symbol='GOOGL', name='Alphabet Inc.', current_price=140.20),
            Stock(symbol='TSLA', name='Tesla, Inc.', current_price=240.10),
            Stock(symbol='MSFT', name='Microsoft Corporation', current_price=330.40),
            Stock(symbol='AMZN', name='Amazon.com, Inc.', current_price=135.60)
        ]
        db.session.bulk_save_objects(stocks)
        
    # Add a mock user if empty
    if User.query.count() == 0:
        user = User(username='trader1', email='trader@example.com', password_hash='hashed_pass')
        db.session.add(user)
    
    db.session.commit()

# --- API Routes ---

@app.route('/api/stocks', methods=['GET'])
def get_stocks():
    stocks = Stock.query.all()
    return jsonify([{
        'symbol': s.symbol,
        'name': s.name,
        'price': s.current_price
    } for s in stocks])

@app.route('/api/portfolio/<int:user_id>', methods=['GET'])
def get_portfolio(user_id):
    portfolio = Portfolio.query.filter_by(user_id=user_id).all()
    return jsonify([{
        'symbol': p.stock_symbol,
        'quantity': p.quantity,
        'avg_price': p.average_price
    } for p in portfolio])

@app.route('/api/user/<int:user_id>', methods=['GET'])
def get_user(user_id):
    user = User.query.get(user_id)
    if user:
        return jsonify({
            'username': user.username,
            'balance': user.balance
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
