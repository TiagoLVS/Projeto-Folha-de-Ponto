#!/usr/bin/env bash

set -e

# Vai para a pasta onde este script está
cd "$(dirname "$0")"

echo "===================================="
echo " Sistema de Folha de Ponto - UnDF"
echo "===================================="

# Verifica o ambiente virtual Python
if [ ! -d ".venv" ]; then
    echo "Criando ambiente virtual Python..."
    python3 -m venv .venv

    echo "Instalando dependências do backend..."
    .venv/bin/python -m pip install -r backend/requirements.txt
fi

echo "Iniciando backend..."
.venv/bin/python -m uvicorn backend.api:app --reload --port 8000 &

BACKEND_PID=$!

# Quando fechar o script, encerra também o backend
cleanup() {
    echo ""
    echo "Encerrando serviços..."
    kill "$BACKEND_PID" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

echo "Backend iniciado em:"
echo "http://127.0.0.1:8000"
echo ""

cd frontend

# Instala dependências apenas se necessário
if [ ! -d "node_modules" ]; then
    echo "Instalando dependências do frontend..."
    npx pnpm@11.25.0 install --frozen-lockfile
fi

echo "Iniciando frontend..."
echo ""

npx pnpm@11.25.0 dev
