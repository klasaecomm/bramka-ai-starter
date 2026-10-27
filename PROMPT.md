# Prompt do wklejenia w Claude Code albo Codex

> [!IMPORTANT]
> **Z modeli Claude korzystamy wyłącznie w oficjalnych aplikacjach Claude (Claude Code, Claude Desktop).**
> Konta Claude w bramce obsługują tylko te aplikacje w trybie bramki. Każde konto w bramce musi być Twoje.

Skopiuj całość z ramki poniżej i wklej jako pierwszą wiadomość. Adres repozytorium jest w pierwszej
linii promptu; przy zmianie nazwy repo podmień go tu i w pierwszej linii [konta/PROMPT.md](konta/PROMPT.md)
(wersja lekka).

```text
REPO = https://github.com/klasaecomm/bramka-ai-starter

Postaw mi na tym komputerze własną bramkę AI z repozytorium REPO: jeden adres dla moich subskrypcji
ChatGPT/Codex i Claude, panel z limitami kont i wspólne serwery MCP. Z modeli Claude korzystam
wyłącznie w oficjalnych aplikacjach Claude (Claude Code, Claude Desktop) — konta Claude w bramce
obsługują tylko te aplikacje. Podłączamy wyłącznie moje własne konta.

1. Sklonuj REPO do ~/bramka-ai (gh repo clone albo git clone) i przeczytaj AGENTS.md — to Twoja instrukcja.
2. Sprawdź wymagania (Docker z Compose, python3, wolne porty) i pokaż mi krótki plan: co zainstalujesz
   albo uruchomisz i jakie pliki zmienisz. Nic nie zmieniaj, dopóki nie napiszę „tak”.
3. Po moim „tak”: ./przygotuj.sh, docker compose up -d --build, potem sprawdź, że bramka, Executor
   i panel działają (bez płatnych wywołań). Nie pokazuj mi haseł ani tokenów w czacie — powiedz tylko,
   jak sam odczytam hasło do panelu.
4. Otwórz mi panel (http://localhost:8080) i poprowadź mnie przez „Połącz konto” (ChatGPT / Codex
   albo Claude) — loguję się sam w przeglądarce. Potem pokaż, jak dodać serwer MCP.
5. Przełącz Codex na bramkę i podłącz wspólne MCP skryptem klienci/przelacz.sh: najpierw na sucho,
   pokaż plan, czekaj na „tak”, dopiero potem --zastosuj. Zapytaj, czy Claude Code i Claude Desktop
   też mają korzystać z bramki (--claude-code, --claude-desktop); bez mojej zgody zostaw je na moim
   własnym logowaniu.
6. Na koniec uruchom diagnostykę i powiedz krótko: co działa, co zostało zmienione, gdzie są kopie
   zapasowe i jak wszystko cofnąć (klienci/przelacz.sh --cofnij, docker compose down).
```
