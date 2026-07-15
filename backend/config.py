import os
from dotenv import load_dotenv

# Load variables from .env file
load_dotenv()

class Config:
    BASE_DIR = os.path.abspath(os.path.dirname(os.path.dirname(__file__)))

    # Use environment variables if set, otherwise fallback to defaults
    default_database_path = os.path.join(BASE_DIR, 'database', 'db.sqlite3')
    env_database_url = os.getenv('DATABASE_URL')

    if env_database_url:
        if env_database_url.startswith('sqlite:///'):
            path_part = env_database_url[len('sqlite:///'):]
            if not os.path.isabs(path_part):
                path_part = os.path.join(BASE_DIR, path_part.replace('/', os.path.sep))
                env_database_url = 'sqlite:///' + path_part.replace('\\', '/')
        SQLALCHEMY_DATABASE_URI = env_database_url
    else:
        SQLALCHEMY_DATABASE_URI = 'sqlite:///' + default_database_path.replace('\\', '/')

    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SECRET_KEY = os.getenv('SECRET_KEY') or 'dev-secret-key'

    STATIC_FOLDER = os.path.join(BASE_DIR, 'frontend')
    DEBUG = os.getenv('DEBUG', 'True') == 'True'
    FINNHUB_API_KEY = os.getenv('FINNHUB_API_KEY')
