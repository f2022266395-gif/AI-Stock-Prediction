#!/bin/bash
pip install -r backend/requirements.txt
exec gunicorn backend.app:app --bind 0.0.0.0:$PORT
