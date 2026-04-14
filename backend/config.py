import os
from dotenv import load_dotenv

# Load variables from .env file
load_dotenv()

class Config:
    BASE_DIR = os.path.abspath(os.path.dirname(os.path.dirname(__file__)))
    
    # Use environment variables if set, otherwise fallback to defaults
    SQLALCHEMY_DATABASE_URI = os.getenv('DATABASE_URL') or \
        'sqlite:///' + os.path.join(BASE_DIR, 'database', 'db.sqlite3')
    
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SECRET_KEY = os.getenv('SECRET_KEY') or 'dev-secret-key'
    
    STATIC_FOLDER = os.path.join(BASE_DIR, 'frontend')
    DEBUG = os.getenv('DEBUG', 'True') == 'True'
