# Serwer z domeną i HTTPS (VPS)

Domyślnie bramka działa tylko na Twoim komputerze. Żeby korzystał z niej cały zespół, postaw ją na
serwerze z Dockerem i dwiema domenami (rekordy A na IP serwera), np. `ai.firma.pl` i `mcp.firma.pl`.

1. Na serwerze: sklonuj repo, `./przygotuj.sh`, potem w `.env`:
   ```
   PANEL_ADRES=https://ai.firma.pl
   BRAMKA_ADRES=https://ai.firma.pl
   MCP_ADRES=https://mcp.firma.pl
   DOMENA_PANELU=ai.firma.pl
   DOMENA_MCP=mcp.firma.pl
   EMAIL_TLS=admin@firma.pl
   ```
   `ADRES_NASLUCHU` zostaw `127.0.0.1` — z internetu ruch idzie tylko przez Caddy.
2. Start z nakładką:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --build
   ```
   Caddy sam pobierze certyfikaty Let's Encrypt (porty 80 i 443 muszą być otwarte).
3. Klienci łączą się z `https://ai.firma.pl` (API modeli pod `/v1`) i `https://mcp.firma.pl/mcp`:
   `./klienci/przelacz.sh --bramka https://ai.firma.pl`.

Co jest wystawione (`konfiguracja/caddy/Caddyfile`): panel, API modeli (`/v1`, `/v1beta`,
`/backend-api`, `/openai`, `/healthz`) i Executor. Management API bramki (`/v0/…`) nie jest
dostępne z internetu. Każda osoba powinna mieć własny token dostępu do bramki (kolejne wartości
w `TOKENY_DOSTEPU`, po przecinku; po zmianie `docker compose up -d`) i własny token MCP z panelu.

Z publicznym adresem HTTPS działa też OAuth serwerów MCP, które wymagają dokumentu klienta
(`/oauth/mcp-client.json` panelu). Kopia zapasowa: wolumeny `bramka-dane` i `executor-dane`
oraz plik `.env` (bez `EXECUTOR_SECRET_KEY` nie odczytasz zapisanych połączeń MCP).
