from flask import Flask, send_from_directory
from flask_cors import CORS
from werkzeug.security import generate_password_hash

from .config import Config
from .models import db, User, Stock, Portfolio
from .routes import api_bp

def create_app():
    app = Flask(__name__, static_folder=Config.STATIC_FOLDER)
    app.config.from_object(Config)
    
    CORS(app)
    db.init_app(app)
    
    # Register API Blueprint
    app.register_blueprint(api_bp, url_prefix='/api')
    
    # Serve Frontend
    @app.route('/')
    def index():
        return send_from_directory(app.static_folder, 'index.html')

    @app.route('/<path:path>')
    def static_proxy(path):
        return send_from_directory(app.static_folder, path)
        
    return app

app = create_app()

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
        # Data seeding logic
        if Stock.query.count() == 0:
            stocks = [
                Stock(ticker='AAPL', company_name='Apple Inc.', latest_price=175.50, sector='Technology'),
                Stock(ticker='GOOGL', company_name='Alphabet Inc.', latest_price=140.20, sector='Technology'),
                Stock(ticker='TSLA', company_name='Tesla, Inc.', latest_price=240.10, sector='Automotive'),
                Stock(ticker='MSFT', company_name='Microsoft Corporation', latest_price=330.40, sector='Technology'),
                Stock(ticker='AMZN', company_name='Amazon.com, Inc.', latest_price=135.60, sector='Consumer Cyclical'),
                Stock(ticker='NVDA', company_name='NVIDIA Corporation', latest_price=450.00, sector='Technology'),
                Stock(ticker='META', company_name='Meta Platforms, Inc.', latest_price=300.00, sector='Technology'),
                Stock(ticker='BRK.B', company_name='Berkshire Hathaway Inc.', latest_price=350.00, sector='Finance'),
                Stock(ticker='V', company_name='Visa Inc.', latest_price=240.00, sector='Finance'),
                Stock(ticker='JPM', company_name='JPMorgan Chase & Co.', latest_price=150.00, sector='Finance'),
                Stock(ticker='UNH', company_name='UnitedHealth Group Incorporated', latest_price=500.00, sector='Healthcare'),
                Stock(ticker='JNJ', company_name='Johnson & Johnson', latest_price=160.00, sector='Healthcare'),
                Stock(ticker='WMT', company_name='Walmart Inc.', latest_price=160.00, sector='Consumer Defensive'),
                Stock(ticker='PG', company_name='Procter & Gamble Company', latest_price=150.00, sector='Consumer Defensive'),
                Stock(ticker='XOM', company_name='Exxon Mobil Corporation', latest_price=110.00, sector='Energy')
            ]
            db.session.bulk_save_objects(stocks)
            db.session.commit()

        # Seed a demo user for endpoint verification
        if User.query.count() == 0:
            demo_user = User(
                full_name='Demo User',
                username='demo',
                email='demo@example.com',
                password_hash=generate_password_hash('demo1234'),
                virtual_balance=10000.00
            )
            db.session.add(demo_user)
            db.session.commit()
            demo_portfolio = Portfolio(user_id=demo_user.user_id, cash_balance=10000.00)
            db.session.add(demo_portfolio)
            db.session.commit()
            
    app.run(debug=True, port=5000)
