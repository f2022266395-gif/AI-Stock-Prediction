import os
import sys

# Support running test_api.py directly or as a module by adding project root to sys.path
root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

from backend.app import create_app
from backend.models import db
from backend.routes.api import get_all_prices, get_market_news

app = create_app()
with app.app_context():
    db.create_all()
    print("Testing get_all_prices:")
    prices = get_all_prices()
    for p in prices:
        print(f"  {p['symbol']}: ${p['price']:.2f} ({p['change_pct']:.2f}%)")
    
    print("\nTesting get_market_news:")
    import asyncio
    # Can't easily test this without running the full Flask app
    # But we can test the finnhub client directly
    import finnhub
    from backend.config import Config
    finnhub_client = finnhub.Client(api_key=Config.FINNHUB_API_KEY)
    try:
        news = finnhub_client.general_news('general', min_id=0)
        print(f"  Got {len(news)} news articles")
        for article in news[:3]:
            print(f"    - {article.get('headline')[:60]}...")
    except Exception as e:
        print(f"  Error: {e}")