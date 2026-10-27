#!/bin/bash
# Test konta.py na izolowanym, tymczasowym HOME — bez prawdziwych kont i bez płatnych wywołań.
# Prawdziwe `claude` i `codex` rozmawiają z lokalną atrapą serwera (testy/atrapa_serwera.py),
# a `security` (pęk kluczy macOS) jest podmienione na atrapę w pliku. Na końcu wszystko jest usuwane.
#
#   bash testy/test_konta.sh
set -u
TU="$(cd "$(dirname "$0")" && pwd)"
KONTA="$TU/../konta.py"
T="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/konta-test-XXXXXX")" && pwd -P)"
H="$T/home"; P="$T/projekt"; LOG="$T/atrapa.log"; TOKEN="TOKEN-BRAMKI-TESTOWY"
PORT=$((20000 + RANDOM % 20000))
mkdir -p "$H" "$P"
python3 "$TU/atrapa_serwera.py" "$PORT" "$LOG" "$TOKEN" & SERWER=$!
sprzatanie() { kill "$SERWER" 2>/dev/null; wait "$SERWER" 2>/dev/null; rm -rf "$T"; }
trap sprzatanie EXIT
sleep 0.5

OK=0; ZLE=0
sprawdz() { # opis, polecenie testujące
  if eval "$2" >/dev/null 2>&1; then OK=$((OK+1)); echo "  OK   $1"; else ZLE=$((ZLE+1)); echo "  ŹLE  $1"; fi
}
# Czyste środowisko: tylko tymczasowy HOME, atrapa `security` na początku PATH.
srodowisko() {
  env -i PATH="$TU/atrapy:$PATH" HOME="$H" USER="${USER:-test}" SHELL=/bin/zsh TERM=dumb LANG=en_US.UTF-8 \
    KONTA_TEST_PEK="$T/pek" BRAMKA_TOKEN="${BRAMKA_TOKEN:-}" CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 DISABLE_AUTOUPDATER=1 "$@"
}
# Uruchomienie w powłoce z wczytanym ~/.konta/env.sh — dokładnie tak, jak w nowym oknie terminala.
w_terminalu() { srodowisko bash -c 'cd "$1"; shift; [ -f "$HOME/.konta/env.sh" ] && . "$HOME/.konta/env.sh"; "$@" </dev/null' _ "$P" "$@"; }
konta() { srodowisko CLAUDE_CONFIG_DIR="$H/.claude" CODEX_HOME="$H/.codex" python3 "$KONTA" "$@"; }
# Claude Code / Codex wobec atrapy (zamiast logowania — lokalny adres testowy).
claude_atrapa() { w_terminalu env ANTHROPIC_BASE_URL="http://127.0.0.1:$PORT" ANTHROPIC_AUTH_TOKEN=atrapa claude "$@"; }
skrot() { [ -e "$1" ] && shasum -a 256 "$1" | cut -c1-16 || echo brak; }
drzewo() { (cd "$H" && find . -print | LC_ALL=C sort | while read -r f; do printf '%s %s\n' "$f" "$( [ -f "$f" ] && skrot "$f")"; done) | shasum | cut -c1-16; }

echo "== Przygotowanie: konto główne z istniejącymi danymi"
# Użytkownik z jawnie ustawionymi katalogami w ~/.zshrc (dzięki temu prawdziwe CLI w teście nigdy
# nie sięga do domyślnego wpisu w pęku kluczy).
printf "alias ll='ls -l'\nexport CLAUDE_CONFIG_DIR=\"%s\"\nexport CODEX_HOME=\"%s\"\n" "$H/.claude" "$H/.codex" > "$H/.zshrc"
mkdir -p "$H/.claude" "$H/.codex"
printf '{\n  "theme": "dark"\n}\n' > "$H/.claude/settings.json"
echo "# moje instrukcje" > "$H/.claude/CLAUDE.md"
mkdir -p "$H/.claude/skills/powitanie"; printf -- '---\nname: powitanie\ndescription: test\n---\nhej\n' > "$H/.claude/skills/powitanie/SKILL.md"
cat > "$H/.codex/config.toml" <<TOML
model = "gpt-test"
model_provider = "atrapa"

[model_providers.atrapa]
name = "atrapa"
base_url = "http://127.0.0.1:$PORT/v1"
wire_api = "responses"
supports_websockets = false
TOML
echo "# moje AGENTS" > "$H/.codex/AGENTS.md"
ZSHRC0=$(skrot "$H/.zshrc"); USTAW0=$(skrot "$H/.claude/settings.json")

echo "== 1. instaluj --na-sucho niczego nie zmienia"
D0=$(drzewo); konta instaluj --na-sucho | sed 's/^/     /'; D1=$(drzewo)
sprawdz "drzewo HOME identyczne po --na-sucho" '[ "$D0" = "$D1" ]'

echo "== 2. instaluj (dwa razy — idempotentnie)"
konta instaluj | sed 's/^/     /'; konta instaluj >/dev/null
sprawdz "blok w ~/.zshrc dokładnie raz" '[ "$(grep -c "konta (przełączanie" "$H/.zshrc")" = 1 ]'
sprawdz "env.sh ustawia konto główne" 'grep -q "export CLAUDE_CONFIG_DIR=.*/home/.claude$" "$H/.konta/env.sh"'
sprawdz "drugie instaluj nie tworzy nowej kopii" '[ "$(ls -d "$H"/.konta/kopie/*/ | wc -l | tr -d " ")" = 1 ]'

echo "== 3. sesje na koncie głównym (Claude Code i Codex wobec atrapy)"
SID=$(claude_atrapa -p "PIERWSZE-PYTANIE-CLAUDE" --output-format json --model claude-sonnet-5 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["session_id"])')
TID=$(w_terminalu codex exec --skip-git-repo-check --json "PIERWSZE-PYTANIE-CODEX" 2>/dev/null | python3 -c '
import json,sys
for l in sys.stdin:
    try: d=json.loads(l)
    except ValueError: continue
    if d.get("type")=="thread.started": print(d["thread_id"])')
sprawdz "sesja Claude zapisana w ~/.claude/projects" 'ls "$H"/.claude/projects/*/"$SID".jsonl'
sprawdz "wątek Codex zapisany w ~/.codex/sessions" '[ -n "$TID" ] && find "$H/.codex/sessions" -name "*$TID*.jsonl" | grep -q .'
w_terminalu claude mcp add -s user wspolny-mcp -- echo hej >/dev/null 2>&1

echo "== 4. dodaj konta (profil; logowanie pominięte w teście: --bez-logowania)"
konta dodaj claude praca --bez-logowania | sed 's/^/     /'
konta dodaj codex praca --bez-logowania >/dev/null
sprawdz "profil claude/praca: projects to dowiązanie do głównego" '[ "$(readlink "$H/.konta/claude/praca/projects")" = "$H/.claude/projects" ]'
sprawdz "profil claude/praca: brak współdzielenia .credentials.json/.claude.json" '[ ! -L "$H/.konta/claude/praca/.claude.json" ] && [ ! -e "$H/.konta/claude/praca/.credentials.json" ]'
sprawdz "profil codex/praca: sessions i config.toml to dowiązania" '[ -L "$H/.konta/codex/praca/sessions" ] && [ -L "$H/.konta/codex/praca/config.toml" ]'
sprawdz "profil codex/praca: auth.json nie jest współdzielony" '[ ! -e "$H/.konta/codex/praca/auth.json" ]'

echo "== 5. uzyj praca → nowe okno terminala używa profilu, historia zostaje"
konta uzyj claude praca | sed 's/^/     /'; konta uzyj codex praca >/dev/null
sprawdz "env.sh wskazuje profil praca" 'grep -q "export CLAUDE_CONFIG_DIR=.*/.konta/claude/praca$" "$H/.konta/env.sh" && grep -q "export CODEX_HOME=.*/.konta/codex/praca$" "$H/.konta/env.sh"'
sprawdz "terminal: CLAUDE_CONFIG_DIR = profil praca" '[ "$(w_terminalu sh -c "echo \$CLAUDE_CONFIG_DIR")" = "$H/.konta/claude/praca" ]'
claude_atrapa -p --resume "$SID" "DRUGIE-PYTANIE-CLAUDE" --output-format json --model claude-sonnet-5 >/dev/null 2>&1
sprawdz "Claude: --resume na koncie praca wysłał całą wcześniejszą rozmowę" 'grep "DRUGIE-PYTANIE-CLAUDE" "$LOG" | grep -q "PIERWSZE-PYTANIE-CLAUDE"'
sprawdz "Claude: CLAUDE.md i skills z głównego widoczne w profilu" '[ -L "$H/.konta/claude/praca/CLAUDE.md" ] && [ -L "$H/.konta/claude/praca/skills" ]'
sprawdz "Claude: MCP z konta głównego widoczny na koncie praca" 'w_terminalu claude mcp list | grep -q wspolny-mcp'
w_terminalu codex exec --skip-git-repo-check --json resume "$TID" "DRUGIE-PYTANIE-CODEX" >/dev/null 2>&1
sprawdz "Codex: resume na koncie praca wysłał całą wcześniejszą rozmowę" 'grep "DRUGIE-PYTANIE-CODEX" "$LOG" | grep -q "PIERWSZE-PYTANIE-CODEX"'
w_terminalu codex mcp add mcp-z-pracy -- echo hej >/dev/null 2>&1
sprawdz "Codex: MCP dodany na koncie praca trafił do wspólnego config.toml" 'grep -q "mcp_servers.mcp-z-pracy" "$H/.codex/config.toml" && [ -L "$H/.konta/codex/praca/config.toml" ]'
echo "     --- konta stan:"; w_terminalu python3 "$H/.konta/konta.py" stan | sed 's/^/     /'

echo "== 6. MCP usunięty na koncie głównym znika z profilu po synchronizacji"
srodowisko CLAUDE_CONFIG_DIR="$H/.claude" claude mcp remove -s user wspolny-mcp >/dev/null 2>&1
konta synchronizuj >/dev/null
sprawdz "wspolny-mcp usunięty z profilu praca" '! grep -q wspolny-mcp "$H/.konta/claude/praca/.claude.json"'

echo "== 7. bramka (modele innych dostawców)"
USTAW_PRZED=$(python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1])), sort_keys=True))' "$H/.claude/settings.json")
TOML_PRZED=$(skrot "$H/.codex/config.toml")
sprawdz "odmowa modelu Claude przez bramkę" '! BRAMKA_TOKEN=$TOKEN konta bramka wlacz --adres "http://127.0.0.1:$PORT" --model claude-opus-5-5'
BRAMKA_TOKEN=$TOKEN konta bramka wlacz --adres "http://127.0.0.1:$PORT" --model gpt-test | sed 's/^/     /'
sprawdz "Claude Code: ANTHROPIC_BASE_URL + apiKeyHelper w settings.json" 'grep -q "\"apiKeyHelper\"" "$H/.claude/settings.json" && grep -q "127.0.0.1:$PORT" "$H/.claude/settings.json"'
sprawdz "token nie trafił do settings.json" '! grep -q "$TOKEN" "$H/.claude/settings.json"'
sprawdz "Codex: model_provider = bramka, stary zakomentowany" 'head -1 "$H/.codex/config.toml" | grep -q "model_provider = \"bramka\"" && grep -q "^# konta: poprzednio: model_provider = \"atrapa\"" "$H/.codex/config.toml"'
: > "$LOG"
w_terminalu claude -p "PYTANIE-PRZEZ-BRAMKE" --output-format json >/dev/null 2>&1
sprawdz "Claude Code przez bramkę: model gpt-test i token z pęku kluczy" 'grep "PYTANIE-PRZEZ-BRAMKE" "$LOG" | grep "\"model\": \"gpt-test\"" | grep -q "\"bearer\": true"'
w_terminalu codex exec --skip-git-repo-check -c model_providers.bramka.requires_openai_auth=false "PYTANIE-CODEX-PRZEZ-BRAMKE" >/dev/null 2>&1
sprawdz "Codex przez bramkę: /v1/responses z nagłówkiem X-Api-Key" 'grep "PYTANIE-CODEX-PRZEZ-BRAMKE" "$LOG" | grep "/v1/responses" | grep -q "\"x_api_key\": true"'
konta bramka wylacz | sed 's/^/     /'
sprawdz "settings.json po wyłączeniu = jak przed włączeniem" '[ "$(python3 -c "import json,sys; print(json.dumps(json.load(open(sys.argv[1])), sort_keys=True))" "$H/.claude/settings.json")" = "$USTAW_PRZED" ]'
sprawdz "config.toml po wyłączeniu = bajt w bajt jak przed włączeniem" '[ "$(skrot "$H/.codex/config.toml")" = "$TOML_PRZED" ]'

echo "== 8. powrót na konto główne"
konta uzyj claude glowne >/dev/null; konta uzyj codex glowne >/dev/null
sprawdz "terminal: CLAUDE_CONFIG_DIR = główny" '[ "$(w_terminalu sh -c "echo \$CLAUDE_CONFIG_DIR")" = "$H/.claude" ]'

echo "== 9. --cofnij aż do stanu sprzed instalacji"
D0=$(drzewo); konta --cofnij --na-sucho >/dev/null; D1=$(drzewo)
sprawdz "--cofnij --na-sucho niczego nie zmienia" '[ "$D0" = "$D1" ]'
for i in $(seq 1 20); do
  WYNIK=$(konta --cofnij 2>&1); echo "$WYNIK" | head -1 | sed 's/^/     /'
  echo "$WYNIK" | grep -q "Nie ma nic do cofnięcia" && break
done
sprawdz "~/.zshrc bajt w bajt jak na początku" '[ "$(skrot "$H/.zshrc")" = "$ZSHRC0" ]'
sprawdz "settings.json bajt w bajt jak na początku" '[ "$(skrot "$H/.claude/settings.json")" = "$USTAW0" ]'
sprawdz "profile usunięte, env.sh i konta.json usunięte" '[ ! -e "$H/.konta/claude/praca" ] && [ ! -e "$H/.konta/codex/praca" ] && [ ! -e "$H/.konta/env.sh" ] && [ ! -e "$H/.konta/konta.json" ]'
sprawdz "historia sesji zachowana w katalogach głównych" 'ls "$H"/.claude/projects/*/"$SID".jsonl && find "$H/.codex/sessions" -name "*$TID*.jsonl" | grep -q .'

echo "== 10. typowy użytkownik: konto główne bez CLAUDE_CONFIG_DIR / CODEX_HOME (atrapy CLI, bez pęku kluczy)"
H2="$T/home2"; mkdir -p "$H2/.claude" "$H2/.codex"; CLI_LOG="$T/cli.log"
echo '{"mcpServers": {"mcp-glowny": {"command": "echo"}}}' > "$H2/.claude.json"
k2() { env -i PATH="$TU/atrapy-cli:$TU/atrapy:/usr/bin:/bin" HOME="$H2" USER=test SHELL=/bin/zsh KONTA_TEST_LOG="$CLI_LOG" python3 "$KONTA" "$@"; }
k2 instaluj >/dev/null
sprawdz "env.sh: unset CLAUDE_CONFIG_DIR i CODEX_HOME dla konta głównego" 'grep -qx "unset CLAUDE_CONFIG_DIR" "$H2/.konta/env.sh" && grep -qx "unset CODEX_HOME" "$H2/.konta/env.sh"'
k2 dodaj claude praca >/dev/null; k2 dodaj codex praca >/dev/null
sprawdz "logowanie: oficjalne claude auth login z CLAUDE_CONFIG_DIR profilu" 'grep -qx "claude auth login | CLAUDE_CONFIG_DIR=$H2/.konta/claude/praca" "$CLI_LOG"'
sprawdz "logowanie: oficjalne codex login z CODEX_HOME profilu" 'grep -qx "codex login | CODEX_HOME=$H2/.konta/codex/praca" "$CLI_LOG"'
sprawdz "MCP czytany z ~/.claude.json (konto główne) i skopiowany do profilu" 'grep -q mcp-glowny "$H2/.konta/claude/praca/.claude.json"'
sprawdz "stan pokazuje zalogowanie profilu" 'k2 stan | grep praca | grep -q "zalogowane (ktos@example.com)"'
k2 --na-sucho uzyj claude praca >/dev/null; k2 uzyj codex praca --na-sucho >/dev/null
sprawdz "--na-sucho przed i po podkomendzie niczego nie przełącza" 'grep -qx "unset CLAUDE_CONFIG_DIR" "$H2/.konta/env.sh" && grep -qx "unset CODEX_HOME" "$H2/.konta/env.sh"'
echo x > "$H2/.konta/codex/praca/nowe_dane.sqlite"; k2 synchronizuj >/dev/null
sprawdz "Codex: nowe dane z profilu przeniesione do wspólnego katalogu i dowiązane" '[ -f "$H2/.codex/nowe_dane.sqlite" ] && [ -L "$H2/.konta/codex/praca/nowe_dane.sqlite" ]'
env -i PATH="$TU/atrapy-cli:$TU/atrapy:/usr/bin:/bin" HOME="$H2" USER=test KONTA_TEST_PEK="$T/pek2" BRAMKA_TOKEN="$TOKEN" \
  python3 "$KONTA" bramka wlacz --adres "http://127.0.0.1:$PORT" --desktop >/dev/null
D3P="$H2/Library/Application Support/Claude-3p"
sprawdz "Claude Desktop: profil bramki bez modeli Claude i tryb 3p" 'grep -q "\"3p\"" "$D3P/claude_desktop_config.json" && grep -q gpt-test "$D3P"/configLibrary/*-konta.json && ! grep -q claude-cos "$D3P"/configLibrary/*-konta.json'
sprawdz "samo --desktop nie zmienia Claude Code ani Codexa" '[ ! -e "$H2/.claude/settings.json" ] || ! grep -q apiKeyHelper "$H2/.claude/settings.json"'
k2 bramka wylacz >/dev/null
sprawdz "Claude Desktop po wyłączeniu: tryb 1p (normalne logowanie)" 'grep -q "\"1p\"" "$D3P/claude_desktop_config.json"'
k2 usun claude praca >/dev/null
sprawdz "usun: oficjalne wylogowanie profilu i usunięcie katalogu" 'grep -qx "claude auth logout | CLAUDE_CONFIG_DIR=$H2/.konta/claude/praca" "$CLI_LOG" && [ ! -e "$H2/.konta/claude/praca" ] && [ -d "$H2/.claude" ]'
sprawdz "narzędzie nie otwiera plików logowania (brak .credentials/auth.json w kodzie poza listą wykluczeń)" '! grep -nE "open\\(.*(credentials|auth\\.json)" "$KONTA"'

H3="$T/home3"; mkdir -p "$H3/.claude"
WYJ3=$(env -i PATH="$TU/atrapy-cli:$TU/atrapy:/usr/bin:/bin" HOME="$H3" USER=test SHELL=/bin/zsh KONTA_TEST_LOG="$CLI_LOG" \
  CLAUDE_CONFIG_DIR="$T/katalog-agenta" python3 "$KONTA" instaluj 2>&1)
sprawdz "agent z własnym CLAUDE_CONFIG_DIR: kontem głównym zostaje ustawienie terminala" 'grep -qx "unset CLAUDE_CONFIG_DIR" "$H3/.konta/env.sh" && echo "$WYJ3" | grep -q "kontem głównym zostaje ustawienie terminala"'

echo
echo "Wynik: $OK OK, $ZLE ŹLE"
[ "$ZLE" = 0 ]
