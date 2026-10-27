# Instrukcja dla agenta: postawienie bramki AI krok po kroku

Jesteś agentem (Claude Code, Codex), który stawia tę bramkę na komputerze użytkownika.
Pracuj po polsku, krótko. Najpierw pokaż plan i poczekaj na wyraźne „tak”.

> [!IMPORTANT]
> **Z modeli Claude korzystamy wyłącznie w oficjalnych aplikacjach Claude (Claude Code, Claude Desktop).**
> Konta Claude w bramce obsługują tylko te aplikacje w trybie bramki — nie podpinaj bramki z kontami
> Claude do innych narzędzi. Bramka przyjmuje konta ChatGPT/Codex i Claude; każde konto musi należeć
> do użytkownika. Kont Google (Gemini/Antigravity) nie podłączaj. Dostęp do bramki to
> „token dostępu do bramki”.

## Zasady

1. Na sucho przed zmianą: pokaż, co zrobisz, i czekaj na „tak”. `klienci/przelacz.sh` bez
   `--zastosuj` tylko pokazuje plan.
2. Sekrety: tylko w `.env` (tworzy `./przygotuj.sh`, plik 0600, w `.gitignore`) i w magazynie systemowym
   (Keychain / secret-tool). Nie wypisuj haseł ani tokenów w odpowiedziach, nie commituj `.env`.
   Hasło do panelu użytkownik odczyta sam: `grep ^PANEL_HASLO .env`.
3. Nie ruszaj istniejących serwerów MCP, pluginów, hooków, CLAUDE.md / AGENTS.md ani profili użytkownika.
   Skrypt klientów tego nie robi — po zmianie pokaż diff kopii z `~/.bramka-ai/kopie/`.
4. Kont dostawców nie logujesz za użytkownika: logowanie w przeglądarce robi on sam w panelu.
5. Bez płatnych wywołań przy sprawdzaniu: wystarczą `/healthz`, `/v1/models`, stan panelu,
   `initialize` / `tools/list` MCP. Nie wywołuj narzędzi MCP ani modeli „na próbę”.
6. Domyślnie wszystko działa lokalnie (`127.0.0.1`). Wystawienie na internet tylko na prośbę i tylko
   z HTTPS ([docs/vps.md](docs/vps.md)).

## Wymagania

- Docker z Compose v2 (`docker compose version`). Docker Desktop / OrbStack / colima — jeśli daemon
  nie działa, zapytaj, czy go uruchomić (`open -a Docker`, `orb start`, `colima start`).
- `python3` i `curl` (skrypt klientów), `openssl` (przygotuj.sh). macOS albo Linux.
- Wolne porty `8080`, `8317`, `4788` na 127.0.0.1 (`lsof -nP -iTCP:<port> -sTCP:LISTEN`). Jeśli zajęte,
  ustaw `PANEL_PORT`, `BRAMKA_PORT`, `MCP_PORT` **i** pasujące `PANEL_ADRES`, `BRAMKA_ADRES`, `MCP_ADRES` w `.env`.

## Kroki

1. **Przygotowanie**: `./przygotuj.sh` (nie nadpisuje istniejących wartości). Ewentualnie `FIRMA`,
   `PANEL_NAZWA` w `.env`.
2. **Start**: `docker compose up -d --build`, potem `docker compose ps` — `bramka` i `executor` mają
   być `healthy`, `panel` `Up`.
3. **Weryfikacja** (bez tokenów na ekranie):
   ```bash
   T=$(sed -n 's/^TOKENY_DOSTEPU=//p' .env | cut -d, -f1)
   curl -s -H "Authorization: Bearer $T" http://localhost:8317/v1/models   # {"data":[],...} przed kontami
   curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8317/v1/models  # 401 bez tokenu
   curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:4788/mcp  # 401 bez tokenu
   curl -s http://localhost:8080/healthz                                       # {"ok":true}
   ```
   W panelu (http://localhost:8080) wiersz stanu ma pokazać „Proxy działa”, a zakładka MCP
   „Executor działa”, oba z oznaczeniem „Tryb demo”.
4. **Konta**: poproś użytkownika, żeby w panelu kliknął „+ Połącz konto” (ChatGPT / Codex albo Claude),
   zalogował się w przeglądarce i wkleił adres z paska. Po pierwszym koncie demo znika,
   a `/v1/models` zwraca modele.
5. **MCP**: użytkownik dodaje serwery w zakładce MCP („+ Dodaj MCP”, potem „Połącz konto” dla OAuth).
   Serwery MCP, których OAuth wymaga publicznego adresu HTTPS panelu, zadziałają dopiero na serwerze (docs/vps.md).
6. **Klienci** (plan → „tak” → `--zastosuj`):
   ```bash
   ./klienci/przelacz.sh                                         # plan: Codex na bramkę
   ./klienci/przelacz.sh --zastosuj                              # Codex CLI + aplikacja
   ./klienci/przelacz.sh --mcp http://localhost:4788/mcp --mcp-token-z-panelu --zastosuj   # wspólne MCP
   ```
   Token dostępu skrypt bierze z `.env` tego repo i zapisuje w Keychainie / secret-tool.
   `--claude-code` / `--claude-desktop` (Claude Code / Claude Desktop przez bramkę) włączaj tylko
   na wyraźną prośbę i powiedz, że `--cofnij` przywraca w nich własne logowanie użytkownika.
7. **Diagnostyka**: `./klienci/przelacz.sh --diagnostyka --mcp http://localhost:4788/mcp`.
   Powiedz użytkownikowi, żeby zrestartował aplikacje.

## Diagnostyka

| Objaw | Sprawdź |
|---|---|
| `bramka` nie startuje | `docker compose logs bramka` — brak `KLUCZ_ZARZADZANIA` / `TOKENY_DOSTEPU` → `./przygotuj.sh` |
| Panel: „Proxy nie odpowiada” | `docker compose ps bramka`; klucz w `.env` zmieniony bez restartu → `docker compose up -d` |
| Panel: „Executor nie odpowiada” | `docker compose logs executor`; `ADMIN_EMAIL`/`ADMIN_HASLO` zmienione po pierwszym starcie nie zmieniają konta w bazie |
| `/v1/models` pusta lista | brak kont — połącz konto w panelu |
| `/v1/models` 401 | zły token; porównaj z `TOKENY_DOSTEPU` (bez wypisywania) |
| Konto „Wylogowane — połącz ponownie” | dostawca unieważnił logowanie; „+ Połącz konto” tym samym kontem |
| OAuth MCP: „wymaga publicznego adresu HTTPS” | dostawca obsługuje tylko dokument klienta — potrzebny serwer z domeną |
| Codex nie widzi bramki | `--diagnostyka`; `~/.codex/config.toml` → `model_provider = "bramka-ai"` |

Logi: `docker compose logs -f --tail 100 <bramka|executor|panel>`. Testy panelu: `cd panel && npm test`.

## Cofnięcie

1. `./klienci/przelacz.sh --cofnij` — przywraca dokładnie poprzednie wartości w Codexie, Claude Code
   i Claude Desktop (własne logowanie użytkownika) i usuwa dodane MCP.
2. `docker compose down` — zatrzymuje usługi, dane zostają. `docker compose down -v` usuwa także
   wolumeny (konta, połączenia MCP) — tylko na wyraźną prośbę.
3. Tokeny w magazynie systemowym: `security delete-generic-password -s bramka-ai-token`
   (i `bramka-ai-mcp`); Linux: `secret-tool clear service bramka-ai-token user "$USER"`.

## Gdzie co jest

| Co | Gdzie |
|---|---|
| Usługi | `docker-compose.yml`, serwer z HTTPS: `docker-compose.vps.yml` + `konfiguracja/caddy/Caddyfile` |
| Konfiguracja bramki | `konfiguracja/bramka/config.yaml`, `start.sh` |
| Panel | `panel/` (`server.mjs`, `index.html`, `demo.mjs`, `limity.mjs`, `executor-mcp.mjs`) |
| Klienci | `klienci/przelacz.sh`, stan i kopie: `~/.bramka-ai/` |
| Wersja lekka (jeden komputer, bez Dockera) | `konta/` — instrukcja `konta/README.md`, prompt `konta/PROMPT.md` |
