# konta — kilka kont Claude Code i Codex, jedna historia

> **Z modeli Claude korzystamy wyłącznie w oficjalnych aplikacjach Claude zalogowanych na własne konto.**

Masz kilka własnych kont Claude (Pro/Max) albo ChatGPT (Codex) na jednym komputerze?
`konta` przełącza konto jedną komendą, a historia sesji zostaje: `claude --resume`
i `codex resume` widzą te same rozmowy na każdym koncie.

Najszybciej: wklej [PROMPT.md](PROMPT.md) do Claude Code albo Codexa. Agent pobierze
narzędzie, najpierw pokaże plan, a zmiany wprowadzi dopiero po Twoim „tak”.

## Jak to działa

- Każde konto ma własny profil, czyli katalog wskazany oficjalną zmienną
  `CLAUDE_CONFIG_DIR` albo `CODEX_HOME`.
- Logujesz się oficjalnym przepływem dostawcy w przeglądarce (`claude auth login`,
  `codex login`). Dane logowania zostają tam, gdzie zapisze je Claude Code / Codex.
  Narzędzie ich nie czyta, nie kopiuje, nie przenosi i nigdzie nie wysyła.
- Profil ma dowiązania do Twojego katalogu głównego (`~/.claude`, `~/.codex`).
  Dzięki temu wszystkie konta korzystają z tych samych danych:

| wspólne dla wszystkich kont | osobne dla każdego konta |
|---|---|
| historia sesji (`projects/`, `sessions/`, bazy historii Codexa), ustawienia, `CLAUDE.md` / `AGENTS.md`, skills, agents, commands, pluginy, MCP | logowanie, stan konta (`.claude.json`, `auth.json`), pliki robocze procesu |

Serwery MCP w Claude Code są zapisywane w `.claude.json` konkretnego konta. Dlatego
`konta` kopiuje je z konta głównego do pozostałych przy każdym przełączeniu. Usunięcie
serwera na koncie głównym usuwa go też z pozostałych kont. W Codexie MCP siedzi
we wspólnym `config.toml`, więc kopiowanie nie jest potrzebne.

## Ręcznie

Wymagany jest Python 3.8+. Na macOS, jeśli go brakuje: `xcode-select --install`.

```bash
python3 konta.py instaluj --na-sucho   # plan bez zmian
python3 konta.py instaluj              # ~/.konta + 1 linia w ~/.zshrc / ~/.bashrc
# nowe okno terminala: od teraz działa komenda `konta`
konta dodaj claude praca               # profil + oficjalne logowanie w przeglądarce
konta dodaj codex prywatne
konta uzyj claude praca                # przełączenie (w tym oknie i w nowych)
konta uzyj claude glowne               # powrót na konto, na którym byłeś wcześniej
konta stan                             # konta, aktywne, zalogowanie, wspólne dane
konta --cofnij                         # cofa ostatnią operację z kopii zapasowej
```

Każda komenda przyjmuje `--na-sucho`. Kopie zapasowe trafiają do `~/.konta/kopie/`.
`--cofnij` można powtarzać aż do stanu sprzed instalacji. Plików, które zmieniły się
później, narzędzie nie nadpisuje: z `~/.zshrc` usuwa tylko swój blok.

## Warto wiedzieć

- Już otwarte sesje działają dalej na poprzednim koncie. Po przełączeniu otwórz
  nowe okno i wznów rozmowę: `claude --resume` / `codex resume`.
- Przełączenie dotyczy terminala i programów uruchomionych z terminala (np. `code .`).
  Aplikacja Codex, Claude Desktop i edytory otwierane z Docka zostają na koncie głównym.
  Konto zmieniasz w nich przez ich własne „Wyloguj / Zaloguj”.
- Nie przenoś katalogu `~/.konta/` ani nie zmieniaj nazw profili. Logowanie Claude Code
  jest powiązane ze ścieżką profilu, więc po zmianie trzeba się zalogować ponownie.
- Każde konto musi być Twoje i używane zgodnie z regulaminem dostawcy. Nie udostępniaj
  kont innym osobom. Narzędzie niczego nie omija: ułatwia tylko wybór, którym własnym
  kontem w danej chwili pracujesz.
- Obsługiwane systemy: macOS i Linux. Windows nie jest obsługiwany.

## Opcjonalnie: bramka z modelami innych dostawców

Jeśli masz dostęp do bramki (gatewaya) z modelami innych dostawców, np. GPT
(choćby bramki z tego repozytorium, zob. [../README.md](../README.md)), możesz ich używać
w interfejsie Claude Code i Codexa:

```bash
konta bramka wlacz --adres https://bramka.example.com --model <model-innego-dostawcy>
konta bramka wylacz                    # powrót do normalnego logowania
```

- Narzędzie poprosi o **token dostępu do bramki** i zapisze go w pęku kluczy systemu
  (macOS Keychain, na Linuksie `secret-tool`).
- **Claude Code:** w `settings.json` ustawia `ANTHROPIC_BASE_URL` i `apiKeyHelper`
  (pomocnik, który odczytuje token z pęku kluczy). Wszystkie aliasy modeli wskazują
  wybrany model innego dostawcy. Modeli Claude przez bramkę narzędzie nie ustawi
  (odmawia).
- **Codex:** dopisuje do `config.toml` dostawcę `[model_providers.bramka]`
  (`wire_api = "responses"`, `requires_openai_auth = true`) z tokenem w nagłówku
  `X-Api-Key` (plik z uprawnieniami tylko dla Ciebie) i ustawia
  `model_provider = "bramka"`.
- **Claude Desktop (macOS, `--desktop`):** dodaje profil „third-party inference”
  z bramką. Wyłączenie przywraca normalne logowanie kontem Claude. Ta część jest
  sprawdzona tylko na plikach konfiguracji, nie w samej aplikacji.
- `bramka wylacz` przywraca poprzednie wartości. Token zostaje w pęku kluczy
  (usługa `konta-bramka`).

## Testy

```bash
bash testy/test_konta.sh
```

Testy działają na tymczasowym katalogu domowym, bez prawdziwych kont i bez płatnych
wywołań. Prawdziwe `claude` i `codex` łączą się z lokalną atrapą serwera, a pęk kluczy
jest podmieniony na atrapę. Sprawdzają m.in.:

- czy sesja założona na jednym koncie wznawia się na drugim z całą historią;
- czy MCP, `CLAUDE.md` i skills są wspólne;
- czy bramka działa i wyłącza się z przywróceniem plików;
- czy `--cofnij` przywraca pliki bajt w bajt.
