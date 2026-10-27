#!/usr/bin/env bash
# Przełącza aplikacje na bramkę AI i z powrotem (macOS, Linux). Domyślnie NA SUCHO: pokazuje plan.
#
#   ./klienci/przelacz.sh --bramka http://localhost:8317                  # plan
#   ./klienci/przelacz.sh --bramka http://localhost:8317 --zastosuj       # Codex (CLI + aplikacja) na bramkę
#   ... --claude-code --zastosuj      # Claude Code: modele innych dostawców w interfejsie Claude
#   ... --claude-desktop --zastosuj   # Claude Desktop (tryb 3P): modele innych dostawców
#   ./klienci/przelacz.sh --mcp http://localhost:4788/mcp --zastosuj      # wspólne MCP (Codex, Claude Code, Claude Desktop)
#   ./klienci/przelacz.sh --diagnostyka
#   ./klienci/przelacz.sh --cofnij    # wszystko z powrotem, także normalne logowanie w Claude
#
# Z modeli Claude korzystamy wyłącznie w oficjalnych aplikacjach Claude zalogowanych na własne
# konto — bramka służy do modeli innych dostawców. Skrypt nie rusza istniejących serwerów MCP,
# pluginów, hooków ani instrukcji. Token dostępu trzyma w Keychainie (macOS) / secret-tool (Linux),
# nie w plikach konfiguracji. Zmienione pola zapisuje w ~/.bramka-ai/stan.json, a --cofnij
# przywraca dokładnie ich poprzednie wartości (kopie plików: ~/.bramka-ai/kopie/).
set -euo pipefail

KATALOG_REPO="$(cd "$(dirname "$0")/.." && pwd)"
ENV_PLIK="$KATALOG_REPO/.env"
env_wartosc() { [ -f "$ENV_PLIK" ] && sed -n "s/^$1=//p" "$ENV_PLIK" | head -1 || true; }

BRAMKA="${BRAMKA_ADRES:-$(env_wartosc BRAMKA_ADRES)}"; BRAMKA="${BRAMKA:-http://localhost:8317}"
PANEL="${PANEL_ADRES:-$(env_wartosc PANEL_ADRES)}"; PANEL="${PANEL:-http://localhost:8080}"
MCP_URL=""; MODEL=""; MALY_MODEL=""
ZASTOSUJ=0; COFNIJ=0; DIAG=0; CODEX=1; CLAUDE_CODE=0; CLAUDE_DESKTOP=0; MCP_TOKEN_Z_PANELU=0
while [ $# -gt 0 ]; do case "$1" in
  --bramka) BRAMKA="$2"; shift;; --bramka=*) BRAMKA="${1#*=}";;
  --mcp) MCP_URL="$2"; shift;; --mcp=*) MCP_URL="${1#*=}";;
  --panel) PANEL="$2"; shift;; --panel=*) PANEL="${1#*=}";;
  --model) MODEL="$2"; shift;; --maly-model) MALY_MODEL="$2"; shift;;
  --zastosuj) ZASTOSUJ=1;; --cofnij) COFNIJ=1;; --diagnostyka) DIAG=1;;
  --claude-code) CLAUDE_CODE=1;; --claude-desktop) CLAUDE_DESKTOP=1;; --bez-codex) CODEX=0;;
  --mcp-token-z-panelu) MCP_TOKEN_Z_PANELU=1;;
  -h|--help) sed -n '2,17p' "$0"; exit 0;;
  *) echo "nieznany argument: $1 (pomoc: --help)"; exit 2;;
esac; shift; done
BRAMKA="${BRAMKA%/}"; PANEL="${PANEL%/}"; MCP_URL="${MCP_URL%/}"
command -v python3 >/dev/null || { echo "Potrzebny python3 (macOS: xcode-select --install)"; exit 1; }

OS="$(uname -s)"; STAN="$HOME/.bramka-ai"; mkdir -p "$STAN/kopie"; chmod 700 "$STAN"
USLUGA_TOKEN=bramka-ai-token; USLUGA_MCP=bramka-ai-mcp
log() { printf '%s\n' "$*"; }
plan() { printf '  [plan] %s\n' "$*"; }

# ---------- magazyn systemowy --------------------------------------------------
sekret_zapisz() { if [ "$OS" = Darwin ]; then security add-generic-password -U -a "$USER" -s "$1" -w "$2" >/dev/null; else command -v secret-tool >/dev/null || { echo "brak secret-tool (pakiet libsecret-tools)"; exit 1; }; printf '%s' "$2" | secret-tool store --label="$1" service "$1" user "$USER"; fi; }
sekret_odczytaj() { if [ "$OS" = Darwin ]; then security find-generic-password -a "$USER" -s "$1" -w 2>/dev/null || true; else secret-tool lookup service "$1" user "$USER" 2>/dev/null || true; fi; }
sekret_usun() { if [ "$OS" = Darwin ]; then security delete-generic-password -a "$USER" -s "$1" >/dev/null 2>&1 || true; else secret-tool clear service "$1" user "$USER" 2>/dev/null || true; fi; }

# Pomocniki: aplikacje pytają o token w chwili użycia, token nie leży w plikach konfiguracji.
napisz_pomocniki() {
  local czytaj='if [ "$(uname -s)" = Darwin ]; then security find-generic-password -a "$USER" -s "$1" -w; else secret-tool lookup service "$1" user "$USER"; fi'
  printf '#!/usr/bin/env bash\n# Token dostępu do bramki z magazynu systemowego.\nczytaj() { %s; }\nczytaj %s\n' "$czytaj" "$USLUGA_TOKEN" > "$STAN/token-bramki.sh"
  printf '#!/usr/bin/env bash\n# Nagłówki dla wspólnego MCP (token z magazynu systemowego).\nczytaj() { %s; }\nprintf '"'"'{"Authorization":"Bearer %%s"}\\n'"'"' "$(czytaj %s)"\n' "$czytaj" "$USLUGA_MCP" > "$STAN/naglowki-mcp.sh"
  chmod 700 "$STAN/token-bramki.sh" "$STAN/naglowki-mcp.sh"
}
napisz_mostek_mcp() {
  # Claude Desktop uruchamia MCP jako proces (stdio): mostek mcp-remote, token przez env, nie w argumentach.
  cat > "$STAN/mcp-stdio.sh" <<SKRYPT
#!/usr/bin/env bash
if [ "\$(uname -s)" = Darwin ]; then T="\$(security find-generic-password -a "\$USER" -s $USLUGA_MCP -w)"; else T="\$(secret-tool lookup service $USLUGA_MCP user "\$USER")"; fi
export BRAMKA_MCP_TOKEN="\$T"
for d in /opt/homebrew/bin /usr/local/bin "\$HOME"/.nvm/versions/node/*/bin; do [ -x "\$d/npx" ] && PATH="\$d:\$PATH"; done
exec npx --yes mcp-remote@0.14.3 "$MCP_URL" --header 'Authorization:Bearer \${BRAMKA_MCP_TOKEN}' --transport http-only
SKRYPT
  chmod 700 "$STAN/mcp-stdio.sh"
}

pobierz_token() {
  local t="${BRAMKA_TOKEN:-}"
  [ -n "$t" ] || t="$(sekret_odczytaj "$USLUGA_TOKEN")"
  if [ -z "$t" ] && [ -f "$ENV_PLIK" ]; then t="$(env_wartosc TOKENY_DOSTEPU | cut -d, -f1)"; [ -n "$t" ] && log "Token dostępu do bramki: pierwszy z $ENV_PLIK (TOKENY_DOSTEPU)" >&2; fi
  if [ -z "$t" ] && [ -t 0 ]; then read -r -s -p "Token dostępu do bramki: " t; echo >&2; fi
  printf '%s' "$t"
}

# ---------- wykrywanie aplikacji ---------------------------------------------
CLAUDE_CLI="$(command -v claude || true)"
CODEX_CLI="$(command -v codex || true)"
for c in /Applications/Codex.app/Contents/Resources/codex /Applications/ChatGPT.app/Contents/Resources/codex; do [ -z "$CODEX_CLI" ] && [ -x "$c" ] && CODEX_CLI="$c"; done
CODEX_CFG="$HOME/.codex/config.toml"; CLAUDE_SETTINGS="$HOME/.claude/settings.json"
if [ "$OS" = Darwin ]; then DESKTOP_3P="$HOME/Library/Application Support/Claude-3p"; DESKTOP_1P="$HOME/Library/Application Support/Claude"; DESKTOP_APP=$([ -d /Applications/Claude.app ] && echo tak || true)
else DESKTOP_3P="$HOME/.config/Claude-3p"; DESKTOP_1P="$HOME/.config/Claude"; DESKTOP_APP=$([ -d "$DESKTOP_1P" ] && echo tak || true); fi
MAMY_CODEX=$([ -n "$CODEX_CLI" ] || [ -d "$HOME/.codex" ] && echo tak || true)

log "Bramka modeli: $BRAMKA${MCP_URL:+ · MCP: $MCP_URL}"
if [ -n "$MAMY_CODEX" ]; then log "Codex:          ${CODEX_CLI:-konfiguracja ~/.codex}"; else log "Codex:          brak"; fi
log "Claude Code:    ${CLAUDE_CLI:-brak}"
log "Claude Desktop: ${DESKTOP_APP:-brak}"

export STAN BRAMKA PANEL MCP_URL MODEL MALY_MODEL CODEX_CFG CLAUDE_SETTINGS DESKTOP_3P DESKTOP_1P ZASTOSUJ

# ---------- diagnostyka --------------------------------------------------------
if [ "$DIAG" = 1 ]; then
  T="$(pobierz_token)"
  log "bramka /healthz: $(curl -s -o /dev/null -w '%{http_code}' "$BRAMKA/healthz" || echo brak)"
  if [ -n "$T" ]; then
    log "modele (z tokenem):"; curl -s -H "Authorization: Bearer $T" "$BRAMKA/v1/models" | python3 -c "import json,sys
try: d=json.load(sys.stdin)
except Exception: print('  (bramka nie zwróciła JSON — sprawdź adres i token)'); sys.exit()
ids=sorted(m['id'] for m in d.get('data',[])); print('  '+', '.join(ids) if ids else '  (brak modeli — połącz pierwsze konto w panelu)')"
  else log "brak tokenu — pomijam /v1/models"; fi
  log "panel /healthz: $(curl -s -o /dev/null -w '%{http_code}' "$PANEL/healthz" || echo brak)"
  [ -n "$MCP_URL" ] && log "MCP (bez tokenu oczekiwane 401): $(curl -s -o /dev/null -w '%{http_code}' -X POST "$MCP_URL" -H 'Content-Type: application/json' -d '{}' || echo brak)"
  python3 - <<'PY'
import json, os, re, pathlib
s = pathlib.Path(os.environ['STAN']) / 'stan.json'
print('zapisany stan przełączenia:', ', '.join(json.loads(s.read_text()).keys()) if s.exists() else 'brak (nic nie przełączono)')
c = pathlib.Path(os.environ['CODEX_CFG'])
if c.exists():
    top = re.split(r'(?m)^\[', c.read_text(), maxsplit=1)[0]
    m = re.search(r'(?m)^model_provider\s*=\s*"([^"]*)"', top)
    print('Codex model_provider:', m.group(1) if m else '(domyślny)')
cs = pathlib.Path(os.environ['CLAUDE_SETTINGS'])
if cs.exists():
    try: print('Claude Code ANTHROPIC_BASE_URL:', json.loads(cs.read_text()).get('env', {}).get('ANTHROPIC_BASE_URL', '(normalne logowanie)'))
    except Exception: pass
PY
  exit 0
fi

# ---------- cofnięcie ------------------------------------------------------------
if [ "$COFNIJ" = 1 ]; then
  [ -f "$STAN/stan.json" ] || { log "Nic do cofnięcia (brak $STAN/stan.json)."; exit 0; }
  KOPIA="$STAN/kopie/cofniecie-$(date +%Y%m%d-%H%M%S)"; mkdir -p "$KOPIA"
  for f in "$CODEX_CFG" "$CLAUDE_SETTINGS" "$DESKTOP_3P/claude_desktop_config.json" "$DESKTOP_3P/configLibrary/_meta.json" "$DESKTOP_1P/claude_desktop_config.json"; do [ -f "$f" ] && cp -p "$f" "$KOPIA/$(printf '%s' "$f" | tr '/' '_')"; done
  if [ -n "$CLAUDE_CLI" ] && python3 -c "import json,sys;sys.exit(0 if json.load(open('$STAN/stan.json')).get('mcp',{}).get('claude_code') else 1)"; then "$CLAUDE_CLI" mcp remove --scope user bramka-mcp >/dev/null 2>&1 && log "Claude Code: usunięto MCP bramka-mcp"; fi
  python3 - <<'PY'
import json, os, re, pathlib
S = pathlib.Path(os.environ['STAN']); stan = json.loads((S / 'stan.json').read_text())
def wroc(d, k, v):
    if v is None: d.pop(k, None)
    else: d[k] = v
def bloki_usun(s, nazwy):
    for n in nazwy: s = re.sub(r'(?ms)^\[' + re.escape(n) + r'\]\s*\n.*?(?=^\[|\Z)', '', s)
    return s
c = pathlib.Path(os.environ['CODEX_CFG'])
if c.exists() and ('codex' in stan or stan.get('mcp', {}).get('codex')):
    s = c.read_text()
    if 'codex' in stan:
        s = bloki_usun(s, ['model_providers.bramka-ai', 'model_providers.bramka-ai.auth'])
        m = re.search(r'(?m)^\[', s); top, reszta = (s[:m.start()], s[m.start():]) if m else (s, '')
        top = re.sub(r'(?m)^model_provider\s*=.*\n?', '', top)
        prev = stan['codex'].get('model_provider')
        if prev: top = prev + '\n' + top
        s = top + reszta
        print('Codex: przywrócono', stan['codex'].get('model_provider') or 'domyślny provider')
    if stan.get('mcp', {}).get('codex'):
        s = bloki_usun(s, ['mcp_servers.bramka-mcp']); print('Codex: usunięto MCP bramka-mcp')
    c.write_text(s.rstrip('\n') + '\n')
cs = pathlib.Path(os.environ['CLAUDE_SETTINGS'])
if 'claude_code' in stan and cs.exists():
    d = json.loads(cs.read_text()); prev = stan['claude_code']
    for k, v in prev.get('env', {}).items(): wroc(d.setdefault('env', {}), k, v)
    if not d.get('env'): d.pop('env', None)
    wroc(d, 'apiKeyHelper', prev.get('apiKeyHelper'))
    cs.write_text(json.dumps(d, indent=2, ensure_ascii=False) + '\n')
    print('Claude Code: przywrócono normalne logowanie (Claude działa jak wcześniej)')
if 'claude_desktop' in stan:
    base = pathlib.Path(os.environ['DESKTOP_3P']); prev = stan['claude_desktop']
    cfg_p = base / 'claude_desktop_config.json'; meta_p = base / 'configLibrary' / '_meta.json'
    if cfg_p.exists():
        cfg = json.loads(cfg_p.read_text()); wroc(cfg, 'deploymentMode', prev.get('deploymentMode')); cfg_p.write_text(json.dumps(cfg, indent=2) + '\n')
    if meta_p.exists():
        meta = json.loads(meta_p.read_text()); meta['entries'] = [e for e in meta.get('entries', []) if e.get('id') != prev['profil']]
        meta['appliedId'] = prev.get('appliedId') or ''; meta_p.write_text(json.dumps(meta, indent=2) + '\n')
    (base / 'configLibrary' / (prev['profil'] + '.json')).unlink(missing_ok=True)
    print('Claude Desktop: tryb', prev.get('deploymentMode') or '1p (normalne logowanie)')
if stan.get('mcp', {}).get('claude_desktop'):
    p = pathlib.Path(os.environ['DESKTOP_1P']) / 'claude_desktop_config.json'
    if p.exists():
        d = json.loads(p.read_text()); d.get('mcpServers', {}).pop('bramka-mcp', None); p.write_text(json.dumps(d, indent=2, ensure_ascii=False) + '\n')
        print('Claude Desktop: usunięto MCP bramka-mcp')
(S / 'stan.json').rename(S / 'kopie' / 'stan-cofniety.json')
PY
  log "Kopia przed cofnięciem: $KOPIA. Tokeny zostały w magazynie systemowym (usuń: security delete-generic-password -s $USLUGA_TOKEN / $USLUGA_MCP)."
  log "Gotowe. Zrestartuj aplikacje."; exit 0
fi

# ---------- plan / zastosowanie ------------------------------------------------
KOPIA="$STAN/kopie/$(date +%Y%m%d-%H%M%S)"
kopia() { [ -f "$1" ] || return 0; mkdir -p "$KOPIA"; cp -p "$1" "$KOPIA/$(printf '%s' "$1" | tr '/' '_')"; }
POTRZEBNY_TOKEN=$([ "$CODEX" = 1 ] && [ -n "$MAMY_CODEX" ] || [ "$CLAUDE_CODE" = 1 ] || [ "$CLAUDE_DESKTOP" = 1 ] && echo tak || true)
MODELE="[]"
if [ "$ZASTOSUJ" = 1 ] && [ -n "$POTRZEBNY_TOKEN" ]; then
  T="$(pobierz_token)"; [ -n "$T" ] || { echo "Brak tokenu dostępu do bramki (BRAMKA_TOKEN, .env albo wpisz w terminalu)."; exit 1; }
  kod="$(curl -s -o "$STAN/modele.json" -w '%{http_code}' -H "Authorization: Bearer $T" "$BRAMKA/v1/models" || true)"
  [ "$kod" = 200 ] || { echo "Bramka odrzuciła token albo nie odpowiada (HTTP $kod) — sprawdź --bramka i docker compose ps"; exit 1; }
  sekret_zapisz "$USLUGA_TOKEN" "$T"; napisz_pomocniki
  MODELE="$(python3 -c "import json;print(json.dumps(sorted(m['id'] for m in json.load(open('$STAN/modele.json')).get('data',[]) if 'claude' not in m['id'].lower())))")"; rm -f "$STAN/modele.json"
  log "Token zapisany w magazynie systemowym ($USLUGA_TOKEN); pomocnik: $STAN/token-bramki.sh; modele: $(python3 -c "import json;print(len(json.loads('$MODELE')))")"
elif [ -n "$POTRZEBNY_TOKEN" ]; then
  plan "token dostępu do bramki → Keychain/secret-tool ($USLUGA_TOKEN), pomocnik $STAN/token-bramki.sh"
fi
export MODELE

# 1. Codex (CLI i aplikacja czytają ten sam ~/.codex/config.toml)
if [ "$CODEX" = 1 ] && [ -n "$MAMY_CODEX" ]; then
  if [ "$ZASTOSUJ" = 1 ]; then
    kopia "$CODEX_CFG"; mkdir -p "$(dirname "$CODEX_CFG")"; touch "$CODEX_CFG"; chmod 600 "$CODEX_CFG"
    python3 - <<'PY'
import json, os, re, pathlib
S = pathlib.Path(os.environ['STAN']); sp = S / 'stan.json'; stan = json.loads(sp.read_text()) if sp.exists() else {}
p = pathlib.Path(os.environ['CODEX_CFG']); s = p.read_text()
m = re.search(r'(?m)^\[', s); top, reszta = (s[:m.start()], s[m.start():]) if m else (s, '')
prev = re.search(r'(?m)^model_provider\s*=.*$', top)
if 'codex' not in stan: stan['codex'] = {'model_provider': prev.group(0) if prev and 'bramka-ai' not in prev.group(0) else None}
top = re.sub(r'(?m)^model_provider\s*=.*\n?', '', top)
top = 'model_provider = "bramka-ai"\n' + top
for n in ['model_providers.bramka-ai', 'model_providers.bramka-ai.auth']:
    reszta = re.sub(r'(?ms)^\[' + re.escape(n) + r'\]\s*\n.*?(?=^\[|\Z)', '', reszta)
blok = ('\n[model_providers.bramka-ai]\n# Bramka AI (CLIProxyAPI). Token dostępu czyta pomocnik z Keychaina / secret-tool.\n'
        'name = "Bramka AI"\nbase_url = ' + json.dumps(os.environ['BRAMKA'] + '/v1') + '\nwire_api = "responses"\nsupports_websockets = false\n\n'
        '[model_providers.bramka-ai.auth]\ncommand = ' + json.dumps(str(S / 'token-bramki.sh')) + '\n')
s = top + reszta.rstrip('\n') + ('\n' if reszta.strip() else '') + blok
try:
    import tomllib; tomllib.loads(s)
except ImportError: pass
p.write_text(s); sp.write_text(json.dumps(stan, indent=2)); os.chmod(sp, 0o600)
print('Codex: model_provider = "bramka-ai" w', p, '(poprzednio:', (stan['codex']['model_provider'] or 'domyślny') + ')')
PY
  else plan "Codex: [model_providers.bramka-ai] (base_url $BRAMKA/v1, token z pomocnika) i model_provider = \"bramka-ai\" w $CODEX_CFG"; fi
fi

# 2. Claude Code: modele innych dostawców w interfejsie Claude (tylko z --claude-code)
if [ "$CLAUDE_CODE" = 1 ]; then
  if [ "$ZASTOSUJ" = 1 ]; then
    kopia "$CLAUDE_SETTINGS"; mkdir -p "$(dirname "$CLAUDE_SETTINGS")"
    python3 - <<'PY'
import json, os, pathlib
S = pathlib.Path(os.environ['STAN']); sp = S / 'stan.json'; stan = json.loads(sp.read_text()) if sp.exists() else {}
modele = json.loads(os.environ['MODELE']); tekst = [m for m in modele if 'image' not in m]
def wybierz(pref, zapas):
    for m in pref:
        if m in tekst: return m
    return zapas
glowny = os.environ.get('MODEL') or wybierz(['gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.5'], tekst[0] if tekst else '')
maly = os.environ.get('MALY_MODEL') or next((m for m in tekst if 'mini' in m), glowny)
if not glowny: raise SystemExit('Bramka nie ma jeszcze modeli — połącz konto w panelu albo podaj --model')
p = pathlib.Path(os.environ['CLAUDE_SETTINGS']); d = json.loads(p.read_text()) if p.exists() and p.read_text().strip() else {}
env = d.setdefault('env', {})
nowe = {'ANTHROPIC_BASE_URL': os.environ['BRAMKA'], 'ANTHROPIC_MODEL': glowny, 'ANTHROPIC_DEFAULT_OPUS_MODEL': glowny,
        'ANTHROPIC_DEFAULT_SONNET_MODEL': glowny, 'ANTHROPIC_DEFAULT_HAIKU_MODEL': maly,
        'CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY': '1', 'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS': '1'}
if 'claude_code' not in stan: stan['claude_code'] = {'env': {k: env.get(k) for k in nowe}, 'apiKeyHelper': d.get('apiKeyHelper')}
env.update(nowe); d['apiKeyHelper'] = str(S / 'token-bramki.sh')
p.write_text(json.dumps(d, indent=2, ensure_ascii=False) + '\n'); sp.write_text(json.dumps(stan, indent=2)); os.chmod(sp, 0o600)
print(f'Claude Code: modele innych dostawców przez bramkę (główny {glowny}, mały {maly}); powrót do Claude: --cofnij')
PY
  else plan "Claude Code (modele innych dostawców w interfejsie Claude): env.ANTHROPIC_BASE_URL=$BRAMKA, modele z /v1/models, apiKeyHelper=$STAN/token-bramki.sh w $CLAUDE_SETTINGS; powrót: --cofnij"; fi
elif [ -n "$CLAUDE_CLI" ]; then
  log "  [pomijam] Claude Code zostaje na Twoim koncie Claude (modele innych dostawców w interfejsie Claude: --claude-code)"
fi

# 3. Claude Desktop: tryb 3P z bramką (tylko z --claude-desktop)
if [ "$CLAUDE_DESKTOP" = 1 ]; then
  if [ "$ZASTOSUJ" = 1 ]; then
    kopia "$DESKTOP_3P/claude_desktop_config.json"; kopia "$DESKTOP_3P/configLibrary/_meta.json"
    python3 - <<'PY'
import json, os, uuid, pathlib
S = pathlib.Path(os.environ['STAN']); sp = S / 'stan.json'; stan = json.loads(sp.read_text()) if sp.exists() else {}
base = pathlib.Path(os.environ['DESKTOP_3P']); lib = base / 'configLibrary'; lib.mkdir(parents=True, exist_ok=True)
meta_p = lib / '_meta.json'; meta = json.loads(meta_p.read_text()) if meta_p.exists() else {'appliedId': '', 'entries': []}
cfg_p = base / 'claude_desktop_config.json'; cfg = json.loads(cfg_p.read_text()) if cfg_p.exists() else {}
ident = next((e['id'] for e in meta['entries'] if e.get('name') == 'Bramka AI'), None) or str(uuid.uuid4())
if 'claude_desktop' not in stan: stan['claude_desktop'] = {'profil': ident, 'deploymentMode': cfg.get('deploymentMode'), 'appliedId': meta.get('appliedId')}
modele = [m for m in json.loads(os.environ['MODELE']) if 'image' not in m]
prof = {'inferenceProvider': 'gateway', 'inferenceGatewayBaseUrl': os.environ['BRAMKA'], 'inferenceCredentialKind': 'helper-script',
        'inferenceCredentialHelper': str(S / 'token-bramki.sh'), 'inferenceGatewayAuthScheme': 'bearer', 'modelDiscoveryEnabled': True,
        'inferenceModels': [{'name': m, 'labelOverride': m} for m in modele]}
(lib / (ident + '.json')).write_text(json.dumps(prof, indent=2)); os.chmod(lib / (ident + '.json'), 0o600)
if not any(e['id'] == ident for e in meta['entries']): meta['entries'].append({'id': ident, 'name': 'Bramka AI'})
meta['appliedId'] = ident; cfg['deploymentMode'] = '3p'
meta_p.write_text(json.dumps(meta, indent=2)); cfg_p.write_text(json.dumps(cfg, indent=2)); os.chmod(cfg_p, 0o600)
sp.write_text(json.dumps(stan, indent=2)); os.chmod(sp, 0o600)
print('Claude Desktop: tryb 3P z bramką (modele innych dostawców:', len(modele), ') — powrót do normalnego logowania: --cofnij')
PY
  else plan "Claude Desktop (modele innych dostawców w interfejsie Claude): profil gateway w $DESKTOP_3P/configLibrary + deploymentMode=3p; powrót: --cofnij"; fi
elif [ -n "$DESKTOP_APP" ]; then
  log "  [pomijam] Claude Desktop zostaje na Twoim koncie Claude (tryb 3P z modelami innych dostawców: --claude-desktop)"
fi

# 4. Wspólne MCP (osobny adres i osobny token dostępu do MCP)
if [ -n "$MCP_URL" ]; then
  if [ "$ZASTOSUJ" = 1 ]; then
    M="${BRAMKA_MCP_TOKEN:-$(sekret_odczytaj "$USLUGA_MCP")}"
    if [ -z "$M" ] && [ "$MCP_TOKEN_Z_PANELU" = 1 ]; then
      # Logowanie hasłem panelu z .env i utworzenie tokenu administratora; token trafia prosto do magazynu, nie na ekran.
      M="$(PANEL_HASLO="$(env_wartosc PANEL_HASLO)" python3 - <<'PY'
import json, os, socket, urllib.request
panel = os.environ['PANEL']; haslo = os.environ.get('PANEL_HASLO') or ''
if not haslo: raise SystemExit('brak PANEL_HASLO w .env')
def req(path, data=None, cookie=None):
    r = urllib.request.Request(panel + path, data=None if data is None else json.dumps(data).encode(), headers={'Content-Type': 'application/json', 'X-Panel': '1', **({'Cookie': cookie} if cookie else {})}, method='POST' if data is not None else 'GET')
    return urllib.request.urlopen(r, timeout=30)
c = req('/api/zaloguj', {'haslo': haslo}).headers['Set-Cookie'].split(';')[0]
users = json.load(req('/api/mcp/uzytkownicy', cookie=c)); admin = next((u for u in users if u.get('admin')), users[0])
print(json.load(req('/api/mcp/token', {'email': admin['email'], 'nazwa': 'mcp-' + socket.gethostname()[:30], 'dni': 365}, cookie=c))['token'], end='')
PY
)"
    fi
    [ -n "$M" ] && [ "$MCP_TOKEN_Z_PANELU" = 1 ] && log "Token dostępu do MCP: utworzony w panelu ($PANEL) dla administratora, ważny 365 dni"
    if [ -z "$M" ] && [ -t 0 ]; then read -r -s -p "Token dostępu do MCP (panel → MCP → Token dostępu): " M; echo; fi
    [ -n "$M" ] || { echo "Brak tokenu MCP (BRAMKA_MCP_TOKEN, --mcp-token-z-panelu albo wpisz w terminalu)"; exit 1; }
    sekret_zapisz "$USLUGA_MCP" "$M"; napisz_pomocniki
    DODANE_CC=0
    if [ -n "$CLAUDE_CLI" ]; then
      if "$CLAUDE_CLI" mcp get bramka-mcp >/dev/null 2>&1; then log "Claude Code: MCP bramka-mcp już jest — bez zmian"
      else "$CLAUDE_CLI" mcp add-json --scope user bramka-mcp "$(python3 -c "import json,os;print(json.dumps({'type':'http','url':os.environ['MCP_URL'],'headersHelper':os.environ['STAN']+'/naglowki-mcp.sh'}))")" >/dev/null && DODANE_CC=1 && log "Claude Code: dodano MCP bramka-mcp (istniejące serwery bez zmian)"; fi
    fi
    [ -n "$DESKTOP_APP" ] && { kopia "$DESKTOP_1P/claude_desktop_config.json"; napisz_mostek_mcp; }
    kopia "$CODEX_CFG"
    DODANE_CC="$DODANE_CC" DESKTOP_APP="$DESKTOP_APP" MAMY_CODEX="$MAMY_CODEX" python3 - <<'PY'
import json, os, re, pathlib
S = pathlib.Path(os.environ['STAN']); sp = S / 'stan.json'; stan = json.loads(sp.read_text()) if sp.exists() else {}
mcp = stan.setdefault('mcp', {})
if os.environ['DODANE_CC'] == '1': mcp['claude_code'] = True
c = pathlib.Path(os.environ['CODEX_CFG'])
if os.environ.get('MAMY_CODEX'):
    c.parent.mkdir(parents=True, exist_ok=True); s = c.read_text() if c.exists() else ''
    if not re.search(r'(?m)^\[mcp_servers\.bramka-mcp\]', s):
        s = s.rstrip('\n') + '\n\n[mcp_servers.bramka-mcp]\nurl = ' + json.dumps(os.environ['MCP_URL']) + '\nhttp_headers_helper = ' + json.dumps(str(S / 'naglowki-mcp.sh')) + '\nstartup_timeout_sec = 60\n'
        c.write_text(s); os.chmod(c, 0o600); mcp['codex'] = True; print('Codex: dodano MCP bramka-mcp')
    else: print('Codex: MCP bramka-mcp już jest — bez zmian')
if os.environ.get('DESKTOP_APP'):
    p = pathlib.Path(os.environ['DESKTOP_1P']) / 'claude_desktop_config.json'; p.parent.mkdir(parents=True, exist_ok=True)
    d = json.loads(p.read_text()) if p.exists() and p.read_text().strip() else {}
    if 'bramka-mcp' not in d.setdefault('mcpServers', {}):
        d['mcpServers']['bramka-mcp'] = {'command': str(S / 'mcp-stdio.sh')}; p.write_text(json.dumps(d, indent=2, ensure_ascii=False) + '\n')
        mcp['claude_desktop'] = True; print('Claude Desktop: dodano MCP bramka-mcp (mostek mcp-remote, wymaga Node.js)')
sp.write_text(json.dumps(stan, indent=2)); os.chmod(sp, 0o600)
PY
  else plan "MCP: token → Keychain/secret-tool ($USLUGA_MCP); Codex [mcp_servers.bramka-mcp], Claude Code: claude mcp add-json bramka-mcp (headersHelper), Claude Desktop: mcpServers.bramka-mcp (mostek mcp-remote) — $MCP_URL"; fi
fi

if [ "$ZASTOSUJ" = 1 ]; then log "Kopie plików: $KOPIA (jeśli coś zmieniono). Cofnięcie: $0 --cofnij. Zrestartuj aplikacje."
else log "To był plan (na sucho). Uruchom z --zastosuj, żeby wprowadzić zmiany."; fi
