# AI-Stock-Prediction

An AI-powered stock prediction web app with a **smart Ensemble Prediction Engine**.

## What to Expect
- Uses an ensemble of indicators (e.g., trend/momentum/RSI + optional Chronos forecasts).
- On the **first run**, it can **automatically download the Amazon Chronos-Bolt model locally** (no manual model setup needed).

## How to Run

### Windows
```bat
python -m venv .venv
pip install -r requirements.txt
python -m backend.app
```

### macOS / Linux
```bash
python -m venv .venv
pip install -r requirements.txt
python -m backend.app
```

## Quick Commands
1. `python -m venv .venv` (Create virtual environment)
2. `pip install -r requirements.txt` (Install dependencies)
3. `python -m backend.app` (Start the server)

