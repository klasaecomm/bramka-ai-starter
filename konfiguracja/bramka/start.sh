#!/bin/sh
# Składa config.yaml z szablonu i tokenów dostępu z .env, potem uruchamia CLIProxyAPI.
set -eu
umask 077
[ -n "${MANAGEMENT_PASSWORD:-}" ] || { echo "brak KLUCZ_ZARZADZANIA w .env (uruchom ./przygotuj.sh)"; exit 1; }
mkdir -p /dane/auth
cel=/dane/config.yaml
cp /konfiguracja/config.yaml "$cel.nowy"
printf '\napi-keys:\n' >> "$cel.nowy"
n=0
for token in $(printf '%s' "${TOKENY_DOSTEPU:-}" | tr ',' ' '); do
  printf '  - "%s"\n' "$token" >> "$cel.nowy"
  n=$((n+1))
done
[ "$n" -gt 0 ] || { echo "brak TOKENY_DOSTEPU w .env (uruchom ./przygotuj.sh)"; exit 1; }
mv "$cel.nowy" "$cel"
echo "config.yaml gotowy: $n token(y) dostępu"
exec /CLIProxyAPI/CLIProxyAPI -config "$cel"
