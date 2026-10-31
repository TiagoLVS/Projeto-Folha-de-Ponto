"""Armazenamento configurável; a instalação de desenvolvimento mantém os caminhos atuais."""
import os
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
DATA = Path(os.getenv('PONTO_DATA_DIR', str(ROOT / 'data'))).resolve()
