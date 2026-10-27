# Jeden prompt: kilka kont Claude Code / Codex bez utraty historii

> **Z modeli Claude korzystamy wyłącznie w oficjalnych aplikacjach Claude zalogowanych na własne konto.**

Skopiuj cały blok poniżej i wklej go do **Claude Code** albo **Codexa** na swoim komputerze.
Agent najpierw pokaże plan i poczeka na Twoje „tak”. Logujesz się zawsze sam, w przeglądarce.

Adres narzędzia jest w pierwszej linii promptu. Jeśli repozytorium zmieni nazwę, wystarczy
podmienić tę jedną linię.

```text
Adres narzędzia: https://raw.githubusercontent.com/klasaecomm/bramka-ai-starter/main/konta/konta.py

Chcę używać kilku moich kont Claude Code i/lub Codex (ChatGPT) na tym komputerze
i przełączać się między nimi bez utraty historii sesji. Skonfiguruj to narzędziem
spod adresu wyżej. Zasady:

1. Z modeli Claude korzystamy wyłącznie w oficjalnych aplikacjach Claude zalogowanych
   na własne konto. Nigdy nie czytaj, nie kopiuj, nie wypisuj ani nie przenoś danych
   logowania (pęk kluczy, .credentials.json, auth.json, tokeny). Logowanie robię sam
   w przeglądarce, oficjalnym przepływem Anthropic / OpenAI.
2. Sprawdź, czy jest python3 (na macOS, jeśli go brak: xcode-select --install).
   Pobierz narzędzie curl-em do nowego, pustego katalogu tymczasowego. Przeczytaj
   je i w kilku zdaniach powiedz mi, co zmieni na dysku.
3. Uruchom: python3 <pobrany plik> instaluj --na-sucho
   Pokaż mi plan. Zapytaj, jakie konta chcę dodać (narzędzie: claude albo codex,
   nazwa konta: małe litery, np. praca, prywatne). Obecne logowanie zostaje kontem
   „glowne”. Niczego nie zmieniaj, dopóki nie odpiszę „tak”.
4. Po „tak”: python3 <pobrany plik> instaluj, a dla każdego konta:
   python3 ~/.konta/konta.py dodaj <claude|codex> <nazwa> --bez-logowania
   Potem podaj mi gotowe polecenia do wpisania w moim terminalu, po jednym na konto:
   python3 ~/.konta/konta.py zaloguj <claude|codex> <nazwa>
   Poczekaj, aż napiszę, że się zalogowałem.
5. Weryfikacja: uruchom python3 ~/.konta/konta.py stan i pokaż mi wynik. Każde konto
   ma być „zalogowane”, a przy każdym dodatkowym koncie liczba wspólnych danych ma się
   zgadzać (np. „wspólne 11/11”). Jeśli coś się nie zgadza, powiedz wprost co.
6. Bramkę z modelami innych dostawców (konta.py bramka wlacz) włącz tylko wtedy,
   gdy wprost o to poproszę i podam adres. Token dostępu do bramki wpiszę sam
   w swoim terminalu, nie w tej rozmowie.
7. Nie zmieniaj niczego poza tym, co robi narzędzie. Moje MCP, pluginy, hooki,
   CLAUDE.md, AGENTS.md i ustawienia mają zostać.
8. Na koniec krótko, po polsku:
   - co zostało zmienione i gdzie leży kopia zapasowa (~/.konta/kopie);
   - jak przełączać konta: w nowym oknie terminala „konta uzyj claude praca”,
     a potem „claude --resume” albo „codex resume”, żeby wrócić do rozmowy;
   - jak wszystko cofnąć: „python3 ~/.konta/konta.py --cofnij”, powtarzane
     aż do komunikatu „Nie ma nic do cofnięcia”.
```

## Co się dzieje po „tak”

- W `~/.konta/` powstaje narzędzie i jego stan, a w `~/.zshrc` / `~/.bashrc` jedna linia,
  która wczytuje aktywne konto. Każde nowe okno terminala ma też komendę `konta`.
- Każde dodatkowe konto dostaje własny profil w `~/.konta/claude/<nazwa>` albo
  `~/.konta/codex/<nazwa>`. Historia, ustawienia, MCP, CLAUDE.md / AGENTS.md
  i skills są wspólne, a logowanie zostaje osobne dla każdego konta.
- Szczegóły i ręczne użycie: [README.md](README.md).
