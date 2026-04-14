from flask import Flask, send_from_directory
from flask_cors import CORS
from config import Config
import os
import sys

# Ensure backend directory is in path for imports
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from models import db, User, Stock, Portfolio
from routes import api_bp

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
                Stock(ticker='AMZN', company_name='Amazon.com, Inc.', latest_price=135.60, sector='Consumer Cyclical')
            ]
            db.session.bulk_save_objects(stocks)
            db.session.commit()
            
    app.run(debug=True, port=5000)
