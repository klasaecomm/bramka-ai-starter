# klienci/ — przełączanie aplikacji na bramkę i z powrotem

> [!IMPORTANT]
> **Z modeli Claude korzystamy wyłącznie w oficjalnych aplikacjach Claude (Claude Code, Claude Desktop).**
> Konta Claude w bramce obsługują tylko te aplikacje w trybie bramki.

`przelacz.sh` (macOS, Linux). Domyślnie **na sucho** — pokazuje plan. Zmiany dopiero z `--zastosuj`.

| Polecenie | Co robi |
|---|---|
| `./klienci/przelacz.sh` | plan dla wykrytych aplikacji |
| `./klienci/przelacz.sh --zastosuj` | **Codex** (CLI i aplikacja): `[model_providers.bramka-ai]` + `model_provider = "bramka-ai"` w `~/.codex/config.toml` |
| `... --claude-code --zastosuj` | **Claude Code** przez bramkę: `ANTHROPIC_BASE_URL`, `apiKeyHelper`, modele z `/v1/models` (wybór w `/model`) |
| `... --claude-desktop --zastosuj` | **Claude Desktop** przez bramkę: tryb 3P (gateway), modele z `/v1/models`, Claude na początku listy |
| `--mcp <adres>/mcp --zastosuj` | wspólne MCP w Codexie, Claude Code i Claude Desktop (token: `--mcp-token-z-panelu` albo wpisany w terminalu) |
| `--diagnostyka` | bramka, modele, panel, MCP, aktualny stan przełączenia |
| `--cofnij` | przywraca dokładnie poprzednie wartości; Claude Code / Desktop wracają do Twojego własnego logowania |

Opcje: `--bramka <adres>` (domyślnie `BRAMKA_ADRES` z `.env`), `--panel <adres>`, `--model <id>` /
`--maly-model <id>` (Claude Code), `--bez-codex`.

- **Token dostępu do bramki**: z `BRAMKA_TOKEN`, z `.env` tego repo (`TOKENY_DOSTEPU`) albo wpisany
  w terminalu. Trafia do Keychaina / secret-tool (`bramka-ai-token`); aplikacje czytają go pomocnikiem
  `~/.bramka-ai/token-bramki.sh`, więc nie leży w ich plikach konfiguracji.
- **Token MCP** (`bramka-ai-mcp`) — osobny; tworzysz go w panelu (MCP → Token dostępu).
- Skrypt nie usuwa ani nie nadpisuje istniejących serwerów MCP, pluginów, hooków ani instrukcji.
  Zmienione pola zapisuje w `~/.bramka-ai/stan.json`, kopie plików w `~/.bramka-ai/kopie/`.
- Claude Code w trybie bramki wysyła zapytania z tokenem dostępu do bramki zamiast własnego logowania
  claude.ai i korzysta z puli kont bramki; funkcje zależne od własnego konta (np. konektory claude.ai)
  wracają po `--cofnij`.
- Claude Desktop (MCP w normalnym trybie) używa mostka `mcp-remote` — wymaga Node.js.
- Windows: skryptu jeszcze nie ma; ustawienia ręcznie z zakładki „Jak podłączyć” w panelu.
