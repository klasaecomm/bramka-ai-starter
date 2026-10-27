# Prompt do wklejenia w Claude Code albo Codex

> [!IMPORTANT]
> **Z modeli Claude korzystamy wyłącznie w oficjalnych aplikacjach Claude (Claude, Claude Code)
> zalogowanych na własne konto — bramka służy do modeli innych dostawców.**

Skopiuj całość z ramki poniżej i wklej jako pierwszą wiadomość. Adres repozytorium jest w pierwszej
linii promptu; przy zmianie nazwy repo podmień go tu i w pierwszej linii [konta/PROMPT.md](konta/PROMPT.md)
(wersja lekka).

```text
REPO = https://github.com/klasaecomm/bramka-ai-starter

Postaw mi na tym komputerze własną bramkę AI z repozytorium REPO: jeden adres dla moich subskrypcji
innych dostawców niż Claude (ChatGPT/Codex), panel z limitami kont i wspólne serwery MCP.
Z modeli Claude korzystam wyłącznie w oficjalnych aplikacjach Claude zalogowanych na moje konto —
do bramki podłączamy wyłącznie moje konta ChatGPT/Codex, żadnych innych.

1. Sklonuj REPO do ~/bramka-ai (gh repo clone albo git clone) i przeczytaj AGENTS.md — to Twoja instrukcja.
2. Sprawdź wymagania (Docker z Compose, python3, wolne porty) i pokaż mi krótki plan: co zainstalujesz
   albo uruchomisz i jakie pliki zmienisz. Nic nie zmieniaj, dopóki nie napiszę „tak”.
3. Po moim „tak”: ./przygotuj.sh, docker compose up -d --build, potem sprawdź, że bramka, Executor
   i panel działają (bez płatnych wywołań). Nie pokazuj mi haseł ani tokenów w czacie — powiedz tylko,
   jak sam odczytam hasło do panelu.
4. Otwórz mi panel (http://localhost:8080) i poprowadź mnie przez „Połącz konto” — loguję się sam
   w przeglądarce. Potem pokaż, jak dodać serwer MCP.
5. Przełącz Codex na bramkę i podłącz wspólne MCP skryptem klienci/przelacz.sh: najpierw na sucho,
   pokaż plan, czekaj na „tak”, dopiero potem --zastosuj. Claude Code i Claude Desktop zostaw na moim
   koncie Claude, chyba że wprost poproszę o modele innych dostawców w interfejsie Claude.
6. Na koniec uruchom diagnostykę i powiedz krótko: co działa, co zostało zmienione, gdzie są kopie
   zapasowe i jak wszystko cofnąć (klienci/przelacz.sh --cofnij, docker compose down).
```
