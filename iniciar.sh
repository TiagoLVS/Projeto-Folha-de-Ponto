#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

migrar=false
verificar=false
for argument in "$@"; do
    case "$argument" in
        --migrar) migrar=true ;;
        --verificar) verificar=true ;;
        -h|--help) echo 'Uso: bash iniciar.sh [--verificar] [--migrar]'; echo '--verificar: verifica dependências e banco sem iniciar os servidores.'; echo '--migrar: autoriza aplicar somente migrações pendentes; faça backup antes.'; exit 0 ;;
        *) echo "Opção desconhecida: $argument. Use --help." >&2; exit 2 ;;
    esac
done
backend_pid=''
frontend_pid=''
etapa='verificar ferramentas'
cleanup() {
    trap - EXIT INT TERM ERR
    for service_pid in "$frontend_pid" "$backend_pid"; do
        if [[ -n "$service_pid" ]]; then
            kill -- "-$service_pid" 2>/dev/null || true
            for attempt in {1..20}; do
                kill -0 -- "-$service_pid" 2>/dev/null || break
                sleep .1
            done
            kill -KILL -- "-$service_pid" 2>/dev/null || true
            wait "$service_pid" 2>/dev/null || true
        fi
    done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'echo "Falha ao $etapa. Confira a mensagem acima." >&2' ERR

for tool in python3 node setsid flock sha256sum; do
    command -v "$tool" >/dev/null || { echo "Ferramenta necessária não encontrada: $tool" >&2; exit 1; }
done
node -e 'const [major,minor]=process.versions.node.split(".").map(Number); if (major<22 || (major===22 && minor<13)) process.exit(1)' || { echo 'Instale Node.js 22.13+ (recomendado 24).' >&2; exit 1; }
exec {startup_lock}>.iniciar.lock
flock -n "$startup_lock" || { echo 'Este projeto já está sendo iniciado por outro iniciar.sh.' >&2; exit 1; }
export BACKEND_PORT="${BACKEND_PORT:-8000}" FRONTEND_PORT="${FRONTEND_PORT:-5173}"
etapa='verificar as portas de rede'
if [[ "$verificar" == false ]]; then python3 backend/startup.py --portas; fi

etapa='preparar o ambiente Python'
if [[ ! -x .venv/bin/python ]]; then python3 -m venv .venv; fi
requirements_hash="$(sha256sum backend/requirements.txt | cut -d ' ' -f 1)"
if [[ ! -f .venv/.requirements.sha256 ]] || [[ "$(cat .venv/.requirements.sha256)" != "$requirements_hash" ]]; then
    PIP_DISABLE_PIP_VERSION_CHECK=1 .venv/bin/python -m pip install -r backend/requirements.txt
    printf '%s\n' "$requirements_hash" > .venv/.requirements.sha256
fi

etapa='verificar o banco'
if [[ "$migrar" == true ]]; then
    .venv/bin/python backend/startup.py --migrar
else
    if .venv/bin/python backend/startup.py; then db_status=0; else db_status=$?; fi
    if [[ "$db_status" == 3 && -t 0 ]]; then
        echo 'SQLs em database/migrations/. Faça backup antes de atualizar o banco existente.'
        read -r -p 'Autoriza aplicar somente as migrações pendentes agora? [s/N] ' answer
        if [[ "$answer" == s || "$answer" == S ]]; then
            .venv/bin/python backend/startup.py --migrar
        else exit 3; fi
    elif [[ "$db_status" != 0 ]]; then exit "$db_status"; fi
fi

etapa='preparar o frontend'
if command -v pnpm >/dev/null; then manager=(pnpm)
elif command -v corepack >/dev/null; then manager=(corepack pnpm)
else manager=(npx --yes pnpm@11.25.0); fi
frontend_hash="$(cat frontend/package.json frontend/pnpm-lock.yaml | sha256sum | cut -d ' ' -f 1)"
if [[ ! -d frontend/node_modules ]] || [[ ! -f frontend/node_modules/.ponto-deps.sha256 ]] || [[ "$(cat frontend/node_modules/.ponto-deps.sha256)" != "$frontend_hash" ]]; then
    (cd frontend && "${manager[@]}" install --frozen-lockfile)
    printf '%s\n' "$frontend_hash" > frontend/node_modules/.ponto-deps.sha256
fi
if [[ "$verificar" == true ]]; then echo 'Verificação concluída. Execute bash iniciar.sh para iniciar.'; exit 0; fi

# A variável de ambiente prevalece sobre .env.local e acompanha a porta escolhida.
export BACKEND_URL="http://127.0.0.1:$BACKEND_PORT"
wait_ready() {
    local service_pid="$1" service_url="$2" service_name="$3"
    for attempt in {1..120}; do
        kill -0 "$service_pid" 2>/dev/null || { echo "$service_name encerrou ao iniciar. Confira o erro acima." >&2; return 1; }
        if .venv/bin/python -c 'import sys,urllib.request; urllib.request.urlopen(sys.argv[1], timeout=1)' "$service_url" 2>/dev/null; then
            sleep .2
            kill -0 "$service_pid" 2>/dev/null || return 1
            return 0
        fi
        sleep .5
    done
    echo "$service_name não respondeu em $service_url. Confira o erro acima." >&2
    return 1
}
etapa='iniciar o backend'
setsid .venv/bin/python -m uvicorn backend.api:app --host 127.0.0.1 --port "$BACKEND_PORT" &
backend_pid=$!
wait_ready "$backend_pid" "$BACKEND_URL/" 'Backend'
etapa='iniciar o frontend'
(cd frontend && exec setsid "${manager[@]}" exec next dev --port "$FRONTEND_PORT") &
frontend_pid=$!
wait_ready "$frontend_pid" "http://localhost:$FRONTEND_PORT" 'Frontend'
printf '\nBackend: %s\nAPI: %s/docs\nFrontend: http://localhost:%s\nCtrl+C encerra os dois serviços.\n\n' "$BACKEND_URL" "$BACKEND_URL" "$FRONTEND_PORT"
etapa='executar os serviços'
if wait -n "$backend_pid" "$frontend_pid"; then code=0; else code=$?; fi
echo "Um dos serviços encerrou (código $code). Encerrando o outro serviço."
exit "$code"
