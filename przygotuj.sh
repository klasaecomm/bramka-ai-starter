#!/usr/bin/env bash
# Tworzy .env z .env.example i wpisuje losowe sekrety w puste pola. Nigdy nie nadpisuje
# istniejących wartości, więc można go uruchamiać wielokrotnie.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { cp .env.example .env; chmod 600 .env; echo "Utworzono .env z .env.example"; }
losuj() { openssl rand -hex "$1" 2>/dev/null || LC_ALL=C tr -dc 'a-f0-9' </dev/urandom | head -c $(( $1 * 2 )); }
ustaw() {
  local klucz="$1" wartosc="$2"
  if grep -qE "^${klucz}=.+" .env; then return 0; fi
  if grep -qE "^${klucz}=" .env; then
    awk -v k="$klucz" -v v="$wartosc" 'BEGIN{FS=OFS="="} $1==k{$0=k"="v} {print}' .env > .env.tmp && mv .env.tmp .env
  else
    printf '%s=%s\n' "$klucz" "$wartosc" >> .env
  fi
  echo "  ustawiono $klucz"
}
ustaw PANEL_HASLO "$(losuj 9)"
ustaw PANEL_SESJA "$(losuj 32)"
ustaw KLUCZ_ZARZADZANIA "$(losuj 24)"
ustaw TOKENY_DOSTEPU "bramka-$(losuj 24)"
ustaw ADMIN_HASLO "$(losuj 12)"
ustaw EXECUTOR_SECRET_KEY "$(losuj 32)"
ustaw EXECUTOR_SESJA "$(losuj 32)"
chmod 600 .env
echo
echo "Gotowe. Sekrety są w pliku .env (tylko dla Ciebie)."
echo "Hasło do panelu:            grep ^PANEL_HASLO .env"
echo "Token dostępu do bramki:    grep ^TOKENY_DOSTEPU .env"
echo "Start:                      docker compose up -d --build"
