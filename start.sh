#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════
#  CMDB Plus Ultra — Script de Inicialização (Linux / macOS)
#  Uso: ./start.sh [porta]
#  Ex:  ./start.sh 8080
# ══════════════════════════════════════════════════════════════

PORTA=${1:-8080}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Verifica Python
if ! command -v python3 &>/dev/null; then
    echo "❌ Python 3 não encontrado. Instale com:"
    echo "   Ubuntu/Debian: sudo apt install python3"
    echo "   CentOS/RHEL:   sudo yum install python3"
    exit 1
fi

# Verifica Flask
if ! python3 -c "import flask" 2>/dev/null; then
    echo "❌ Flask não encontrado. Instale com:"
    echo "   pip3 install flask"
    echo "   ou: pip3 install flask --user"
    exit 1
fi

echo ""
echo "✔ Python $(python3 --version | cut -d' ' -f2) — Flask disponível"
echo ""

cd "$SCRIPT_DIR"
CMDB_PORT=$PORTA python3 server.py
