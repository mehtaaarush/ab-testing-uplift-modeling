"""Paths and experiment constants."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw"
DOCS_DATA_DIR = ROOT / "docs" / "data"
REPORTS_DIR = ROOT / "reports"
FIGURES_DIR = REPORTS_DIR / "figures"

DATA_URL = "http://www.minethatdata.com/Kevin_Hillstrom_MineThatData_E-MailAnalytics_DataMiningChallenge_2008.03.20.csv"
DATA_FILE = RAW_DIR / "hillstrom_email_experiment.csv"

# Arms as labelled in the source file -> short keys used throughout
ARMS = {"No E-Mail": "control", "Mens E-Mail": "mens", "Womens E-Mail": "womens"}
TREATMENTS = ["mens", "womens"]
METRICS = {"visit": "Visit rate", "conversion": "Conversion rate", "spend": "Revenue per customer"}

ALPHA = 0.05
TEST_SIZE = 0.3
RANDOM_STATE = 7

# Uplift modelling: visits are the primary target (conversions are ~1% and too sparse to rank on)
UPLIFT_TARGET = "visit"
CV_FOLDS = 5
N_BOOT = 300
