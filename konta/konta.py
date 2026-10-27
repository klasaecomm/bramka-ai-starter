#!/usr/bin/env python3
"""konta — kilka kont Claude Code i Codex na jednym komputerze, wspólna historia.

Każde konto ma własny profil (oficjalne zmienne CLAUDE_CONFIG_DIR / CODEX_HOME)
i loguje się oficjalnym przepływem dostawcy (`claude auth login`, `codex login`).
Narzędzie nigdy nie czyta, nie kopiuje ani nie przenosi danych logowania.
Wspólne dla wszystkich kont (dowiązania do katalogu głównego ~/.claude, ~/.codex):
historia sesji, ustawienia, MCP, CLAUDE.md / AGENTS.md, skills, pluginy.

  konta.py instaluj                        # przygotowanie (1 linia w ~/.zshrc / ~/.bashrc)
  konta.py dodaj claude praca              # nowy profil + oficjalne logowanie w przeglądarce
  konta.py uzyj claude praca               # przełączenie aktywnego konta
  konta.py stan                            # konta, aktywne, zalogowanie, dowiązania
  konta.py synchronizuj                    # odświeża dowiązania i MCP we wszystkich profilach
  konta.py zaloguj claude praca            # ponowne logowanie w profilu
  konta.py usun claude praca               # wylogowanie i usunięcie profilu
  konta.py bramka wlacz --adres URL ...    # opcjonalnie: modele innych dostawców przez bramkę
  konta.py bramka wylacz                   # powrót do normalnego logowania
  konta.py --cofnij                        # cofa ostatnią operację (z kopii zapasowej)

Każda komenda przyjmuje --na-sucho: pokazuje plan i niczego nie zmienia.
Wymaga Pythona 3.8+ (macOS, Linux). Bez zewnętrznych bibliotek.
"""
import argparse
import datetime
import getpass
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

DOM = Path.home() / ".konta"
STAN = DOM / "konta.json"
ENV_SH = DOM / "env.sh"
KOPIE = DOM / "kopie"
POMOCNIK = DOM / "token-bramki.sh"
GLOWNE = "glowne"
NAZWA_KONTA = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")
RC_START = "# >>> konta (przełączanie kont Claude Code / Codex) >>>"
RC_KONIEC = "# <<< konta <<<"

# Claude Code: współdzielimy tylko to, co jest na liście. Logowanie (.credentials.json,
# pęk kluczy), stan konta (.claude.json) i pamięci podręczne zostają w profilu.
CLAUDE_WSPOLNE = [
    "CLAUDE.md", "settings.json", "keybindings.json", "history.jsonl",
    "projects", "file-history", "plans", "tasks", "todos", "session-env", "paste-cache",
    "skills", "agents", "commands", "output-styles", "rules", "workflows", "agent-memory",
    "plugins", "hooks", "themes",
]
CLAUDE_ZAWSZE_KATALOGI = ["projects", "file-history", "plans", "tasks", "skills", "agents", "commands", "plugins"]
CLAUDE_ZAWSZE_PLIKI = {"settings.json": "{}\n", "history.jsonl": ""}
# Z .claude.json konta głównego przenosimy do profili tylko konfigurację MCP i zaufanie do folderów.
CLAUDE_KLUCZE_PROJEKTU = ("mcpServers", "enabledMcpjsonServers", "disabledMcpjsonServers", "hasTrustDialogAccepted")

# Codex: współdzielimy wszystko poza logowaniem i plikami uruchomieniowymi danego procesu.
CODEX_PRYWATNE = {"auth.json", "models_cache.json", ".codex-global-state.json", "log", "tmp", ".tmp",
                  "app-server-daemon", "app-server-control", "ipc", ".DS_Store"}
CODEX_ZAWSZE_KATALOGI = ["sessions", "archived_sessions", "skills"]

NARZEDZIA = {
    "claude": {"nazwa": "Claude Code", "zmienna": "CLAUDE_CONFIG_DIR", "domyslny": "~/.claude",
               "zaloguj": ["claude", "auth", "login"], "wyloguj": ["claude", "auth", "logout"]},
    "codex": {"nazwa": "Codex", "zmienna": "CODEX_HOME", "domyslny": "~/.codex",
              "zaloguj": ["codex", "login"], "wyloguj": ["codex", "logout"]},
}

# Tryb bramki w Claude Code: tylko modele innych dostawców, wszystkie aliasy modeli na wybrany model.
CLAUDE_BRAMKA_KLUCZE = ["apiKeyHelper", "model"]
CLAUDE_BRAMKA_ENV = ["ANTHROPIC_BASE_URL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL",
                     "ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_DEFAULT_FABLE_MODEL", "CLAUDE_CODE_SUBAGENT_MODEL"]
CODEX_BLOK_START = "# >>> konta: bramka >>>"
CODEX_BLOK_KONIEC = "# <<< konta: bramka <<<"
CODEX_ZNACZNIK = "  # konta: bramka"
CODEX_POPRZEDNIO = "# konta: poprzednio: "
USLUGA_TOKENU = "konta-bramka"
ZASADA = "Z modeli Claude korzystamy wyłącznie w oficjalnych aplikacjach Claude zalogowanych na własne konto."

NA_SUCHO = False
OPERACJA = None


class Blad(Exception):
    pass


# ---------------------------------------------------------------- wypisywanie i pliki

def krok(tekst):
    print(("  [plan] " if NA_SUCHO else "  ✓ ") + tekst)


def uwaga(tekst):
    print("  ! " + tekst)


def skroc(sciezka):
    s, dom = str(sciezka), str(Path.home())
    return "~" + s[len(dom):] if s == dom or s.startswith(dom + os.sep) else s


def wczytaj_json(sciezka, domyslne=None):
    try:
        with open(sciezka, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return domyslne
    except ValueError as e:
        raise Blad("nie mogę odczytać %s (%s) — popraw plik i uruchom ponownie" % (skroc(sciezka), e))


def skrot_pliku(sciezka):
    try:
        return hashlib.sha256(Path(sciezka).read_bytes()).hexdigest()
    except FileNotFoundError:
        return None


class Operacja:
    """Kopia zapasowa jednej operacji: pliki sprzed zmiany + utworzone profile. Odtwarza ją --cofnij."""

    def __init__(self, opis):
        self.opis = opis
        self.czas = datetime.datetime.now()
        self.katalog = KOPIE / (self.czas.strftime("%Y%m%d-%H%M%S-%f") + "-" + opis.split()[0])
        self.wpisy = []

    def plik(self, sciezka):
        sciezka = str(sciezka)
        if NA_SUCHO or any(w.get("sciezka") == sciezka for w in self.wpisy):
            return
        wpis = {"typ": "plik", "sciezka": sciezka, "kopia": None}
        if os.path.exists(sciezka):
            self.katalog.mkdir(parents=True, exist_ok=True)
            wpis["kopia"] = "%03d-%s" % (len(self.wpisy), os.path.basename(sciezka))
            shutil.copy2(sciezka, self.katalog / wpis["kopia"])
        self.wpisy.append(wpis)

    def profil(self, narz, nazwa, sciezka):
        if not NA_SUCHO:
            self.wpisy.append({"typ": "profil", "narz": narz, "nazwa": nazwa, "sciezka": str(sciezka)})

    def zakoncz(self):
        if NA_SUCHO or not self.wpisy:
            return
        for w in self.wpisy:
            if w["typ"] == "plik":
                w["skrot_po"] = skrot_pliku(w["sciezka"])
        self.katalog.mkdir(parents=True, exist_ok=True)
        manifest = {"opis": self.opis, "czas": self.czas.isoformat(timespec="seconds"), "wpisy": self.wpisy}
        (self.katalog / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
        print("  Kopia zapasowa: %s (cofnięcie: konta.py --cofnij)" % skroc(self.katalog))


def zapisz_plik(sciezka, tresc, tryb=None, opis=None):
    """Zapisuje plik atomowo (przez dowiązanie do celu), z kopią w bieżącej operacji. Bez zmian = nic."""
    cel = Path(os.path.realpath(sciezka))
    if cel.exists() and cel.read_text(encoding="utf-8") == tresc:
        return False
    krok(opis or ("zapis %s" % skroc(sciezka)))
    if NA_SUCHO:
        return True
    OPERACJA.plik(cel)
    cel.parent.mkdir(parents=True, exist_ok=True)
    tmp = cel.with_name(cel.name + ".konta-tmp")
    tmp.write_text(tresc, encoding="utf-8")
    if tryb is not None:
        os.chmod(tmp, tryb)
    elif cel.exists():
        os.chmod(tmp, cel.stat().st_mode & 0o777)
    os.replace(tmp, cel)
    return True


def zapisz_json(sciezka, dane, tryb=None, opis=None):
    return zapisz_plik(sciezka, json.dumps(dane, ensure_ascii=False, indent=2) + "\n", tryb, opis)


def utworz_katalog(sciezka, tryb=0o755):
    if sciezka.is_dir():
        return
    krok("katalog %s" % skroc(sciezka))
    if not NA_SUCHO:
        sciezka.mkdir(parents=True, mode=tryb)


# ---------------------------------------------------------------- stan i profile

def wczytaj_stan(wymagany=True):
    stan = wczytaj_json(STAN)
    if stan is None and wymagany:
        raise Blad("najpierw uruchom: python3 konta.py instaluj")
    return stan


def katalog_konta(stan, narz, nazwa):
    return Path(stan[narz]["konta"][nazwa]["katalog"])


def katalog_doslownie(stan, narz, nazwa):
    """Ścieżka profilu dokładnie w zapisanej postaci: Claude Code wiąże z tym napisem wpis w pęku kluczy."""
    return stan[narz]["konta"][nazwa]["katalog"]


def plik_globalny_claude(stan, nazwa):
    """.claude.json: dla katalogu domyślnego leży w HOME, przy CLAUDE_CONFIG_DIR — w tym katalogu."""
    kat = katalog_konta(stan, "claude", nazwa)
    jawny = nazwa != GLOWNE or stan["claude"].get("glowny_jawny")
    return (kat if jawny else Path.home()) / ".claude.json"


def srodowisko(stan, narz, nazwa):
    """Środowisko procesu narzędzia dla danego konta (tak samo jak w env.sh)."""
    env = dict(os.environ)
    zmienna = NARZEDZIA[narz]["zmienna"]
    if nazwa == GLOWNE and not stan[narz].get("glowny_jawny"):
        env.pop(zmienna, None)
    else:
        env[zmienna] = katalog_doslownie(stan, narz, nazwa)
    return env


def sprawdz_narzedzie(stan, narz):
    if narz not in NARZEDZIA:
        raise Blad("narzędzie: claude albo codex")
    if narz not in stan:
        raise Blad("%s nie było wykryte przy instalacji — zainstaluj je i uruchom: konta.py instaluj" % NARZEDZIA[narz]["nazwa"])


def sprawdz_konto(stan, narz, nazwa):
    sprawdz_narzedzie(stan, narz)
    if nazwa not in stan[narz]["konta"]:
        raise Blad("nie ma konta %s/%s (lista: konta.py stan)" % (narz, nazwa))


def dzialajace(nazwa_procesu):
    if not shutil.which("pgrep"):
        return []
    return subprocess.run(["pgrep", "-x", nazwa_procesu], capture_output=True, text=True).stdout.split()


def wspoldzielony_codex(nazwa):
    return nazwa not in CODEX_PRYWATNE and not nazwa.startswith("..") and ".tmp" not in nazwa


def wpisy_wspolne(narz, glowny):
    if narz == "claude":
        return [n for n in CLAUDE_WSPOLNE if os.path.lexists(glowny / n)]
    return sorted(n for n in os.listdir(glowny) if wspoldzielony_codex(n)) if glowny.is_dir() else []


def przygotuj_glowny(narz, glowny):
    """Tworzy w katalogu głównym puste miejsca na wspólne dane, zanim profil założy własne."""
    utworz_katalog(glowny, 0o700)
    for k in (CLAUDE_ZAWSZE_KATALOGI if narz == "claude" else CODEX_ZAWSZE_KATALOGI):
        if not os.path.lexists(glowny / k):
            utworz_katalog(glowny / k)
    if narz == "claude":
        for n, tresc in CLAUDE_ZAWSZE_PLIKI.items():
            if not os.path.lexists(glowny / n):
                zapisz_plik(glowny / n, tresc, 0o600)


def przejmij_nowe_z_profilu(glowny, profil):
    """Codex: dane, które profil utworzył sam (np. nowa baza po aktualizacji), a których nie ma
    w katalogu głównym, przenosimy do głównego i zastępujemy dowiązaniem — tylko gdy Codex nie działa."""
    kandydaci = [n for n in os.listdir(profil) if wspoldzielony_codex(n)
                 and not os.path.islink(profil / n) and not os.path.lexists(glowny / n)]
    if not kandydaci:
        return
    if dzialajace("codex"):
        uwaga("profil %s ma nowe dane (%s) — zamknij Codex i uruchom: konta.py synchronizuj"
              % (skroc(profil), ", ".join(kandydaci)))
        return
    for n in kandydaci:
        krok("przenoszę %s do wspólnego %s" % (skroc(profil / n), skroc(glowny)))
        if not NA_SUCHO:
            shutil.move(str(profil / n), str(glowny / n))


def synchronizuj_dowiazania(narz, glowny, profil):
    """Dowiązania profil/<wpis> -> glowny/<wpis>. Pliki, które profil ma jako własne, zostawia i zgłasza."""
    if narz == "codex" and profil.is_dir():
        przejmij_nowe_z_profilu(glowny, profil)
    konflikty = []
    for n in wpisy_wspolne(narz, glowny):
        zrodlo, cel = glowny / n, profil / n
        if os.path.islink(cel):
            if os.readlink(cel) == str(zrodlo):
                continue
            krok("poprawiam dowiązanie %s" % skroc(cel))
            if not NA_SUCHO:
                os.unlink(cel)
                os.symlink(zrodlo, cel)
        elif os.path.lexists(cel):
            konflikty.append(n)
        else:
            krok("dowiązanie %s -> %s" % (skroc(cel), skroc(zrodlo)))
            if not NA_SUCHO:
                os.symlink(zrodlo, cel)
    for n in konflikty:
        uwaga("%s ma własny %s (nie dowiązanie) — zostawiam bez zmian" % (skroc(profil), n))
    return konflikty


def synchronizuj_mcp(stan):
    """Claude Code trzyma MCP (zakres user i local) w .claude.json każdego profilu. Konto główne jest
    źródłem: jego serwery trafiają do profili, a usunięte z głównego znikają też z profili.
    Plik konta głównego tylko czytamy."""
    if "claude" not in stan:
        return
    zrodlo = wczytaj_json(plik_globalny_claude(stan, GLOWNE), {}) or {}
    serwery = zrodlo.get("mcpServers") or {}
    projekty = {}
    for sciezka, dane in (zrodlo.get("projects") or {}).items():
        wybrane = {k: dane[k] for k in CLAUDE_KLUCZE_PROJEKTU if isinstance(dane, dict) and dane.get(k)}
        if wybrane:
            projekty[sciezka] = wybrane
    poprzednie = set(stan["claude"].get("mcp_z_glownego", []))
    for nazwa in stan["claude"]["konta"]:
        if nazwa == GLOWNE or not katalog_konta(stan, "claude", nazwa).is_dir():
            continue
        sciezka = plik_globalny_claude(stan, nazwa)
        cel = wczytaj_json(sciezka, {}) or {}
        nowy = json.loads(json.dumps(cel))
        cel_serwery = nowy.setdefault("mcpServers", {})
        for n in poprzednie - set(serwery):
            cel_serwery.pop(n, None)
        cel_serwery.update(serwery)
        for p, dane in projekty.items():
            nowy.setdefault("projects", {}).setdefault(p, {}).update(dane)
        if nowy != cel:
            zapisz_json(sciezka, nowy, 0o600, "MCP i zaufane foldery -> profil %s (%s)"
                        % (nazwa, ", ".join(sorted(serwery)) or "bez serwerów MCP"))
    stan["claude"]["mcp_z_glownego"] = sorted(serwery)


def synchronizuj_profil(stan, narz, nazwa):
    glowny = katalog_konta(stan, narz, GLOWNE)
    przygotuj_glowny(narz, glowny)
    return synchronizuj_dowiazania(narz, glowny, katalog_konta(stan, narz, nazwa))


def napisz_env(stan):
    linie = ["# Wygenerowane przez konta.py — nie edytuj ręcznie. Zmiana konta: konta uzyj <claude|codex> <nazwa>"]
    for narz, opis in NARZEDZIA.items():
        if narz not in stan:
            continue
        aktywne = stan[narz]["aktywne"]
        linie.append("# %s: konto \"%s\"" % (opis["nazwa"], aktywne))
        if aktywne == GLOWNE and not stan[narz].get("glowny_jawny"):
            linie.append("unset %s" % opis["zmienna"])
        else:
            linie.append("export %s=%s" % (opis["zmienna"], shlex.quote(katalog_doslownie(stan, narz, aktywne))))
    linie.append('konta() { python3 "$HOME/.konta/konta.py" "$@"; _konta_kod=$?; '
                 '[ -f "$HOME/.konta/env.sh" ] && . "$HOME/.konta/env.sh"; return $_konta_kod; }')
    zapisz_plik(ENV_SH, "\n".join(linie) + "\n", 0o644)


def zapisz_stan(stan):
    zapisz_json(STAN, stan, 0o600, "stan kont %s" % skroc(STAN))


def zmienna_z_terminala(zmienna):
    """Wartość zmiennej w nowym oknie terminala użytkownika. Proces, który nas uruchomił (agent,
    aplikacja), może mieć własną — konto główne to to, którego używa zwykły terminal."""
    znacznik = "__KONTA__"
    try:
        r = subprocess.run([os.environ.get("SHELL") or "/bin/sh", "-ilc",
                            "printf '\\n%s%%s\\n' \"${%s-}\"" % (znacznik, zmienna)],
                           capture_output=True, text=True, timeout=20, stdin=subprocess.DEVNULL,
                           env={k: v for k, v in os.environ.items() if k != zmienna})
        linie = [l for l in r.stdout.splitlines() if l.startswith(znacznik)]
        if linie:
            return linie[-1][len(znacznik):] or None
    except (OSError, subprocess.TimeoutExpired):
        pass
    return os.environ.get(zmienna)


def pliki_powloki():
    dom = Path.home()
    pliki = [p for p in (dom / ".zshrc", dom / ".bashrc", dom / ".bash_profile") if p.exists()]
    powloka = os.path.basename(os.environ.get("SHELL", ""))
    domyslny = dom / (".zshrc" if powloka == "zsh" or (sys.platform == "darwin" and powloka != "bash") else ".bashrc")
    if domyslny not in pliki:
        pliki.insert(0, domyslny)
    return pliki


# ---------------------------------------------------------------- komendy

def instaluj(args):
    if os.name == "nt":
        raise Blad("Windows nie jest obsługiwany (macOS, Linux)")
    stan = wczytaj_stan(wymagany=False) or {"wersja": 1}
    utworz_katalog(DOM, 0o700)
    for narz, opis in NARZEDZIA.items():
        if narz in stan:
            continue
        z_env = zmienna_z_terminala(opis["zmienna"])
        if z_env and str(os.path.realpath(DOM)) in os.path.realpath(z_env):
            z_env = None  # to już nasz profil, nie konto główne
        if os.environ.get(opis["zmienna"]) and os.environ.get(opis["zmienna"]) != z_env:
            uwaga("ten proces ma %s=%s, ale terminal nie — kontem głównym zostaje ustawienie terminala"
                  % (opis["zmienna"], os.environ[opis["zmienna"]]))
        glowny = z_env or os.path.expanduser(opis["domyslny"])
        if not shutil.which(narz) and not os.path.isdir(glowny):
            print("  – %s: nie znaleziono (pomijam)" % opis["nazwa"])
            continue
        stan[narz] = {"aktywne": GLOWNE, "glowny_jawny": bool(z_env),
                      "konta": {GLOWNE: {"katalog": glowny}}}
        krok("%s: obecne logowanie = konto \"%s\" (%s)" % (opis["nazwa"], GLOWNE, skroc(glowny)))
    if not any(n in stan for n in NARZEDZIA):
        raise Blad("nie znalazłem ani Claude Code, ani Codex")
    ten = Path(os.path.realpath(__file__))
    kopia = DOM / "konta.py"
    if ten != Path(os.path.realpath(kopia)):
        zapisz_plik(kopia, ten.read_text(encoding="utf-8"), 0o755, "narzędzie -> %s" % skroc(kopia))
    zapisz_stan(stan)
    napisz_env(stan)
    blok = '%s\n[ -f "$HOME/.konta/env.sh" ] && . "$HOME/.konta/env.sh"\n%s\n' % (RC_START, RC_KONIEC)
    for rc in pliki_powloki():
        tresc = rc.read_text(encoding="utf-8") if rc.exists() else ""
        if RC_START not in tresc:
            zapisz_plik(rc, tresc + ("\n" if tresc and not tresc.endswith("\n") else "") + "\n" + blok,
                        opis="1 linia w %s (wczytuje ~/.konta/env.sh)" % skroc(rc))
    print("Dalej: konta.py dodaj claude <nazwa>  /  konta.py dodaj codex <nazwa>. "
          "Nowe okna terminala znają już komendę `konta`.")


def dodaj(args):
    stan = wczytaj_stan()
    narz, nazwa = args.narzedzie, args.nazwa
    sprawdz_narzedzie(stan, narz)
    if not NAZWA_KONTA.match(nazwa):
        raise Blad("nazwa konta: małe litery, cyfry, - i _ (np. praca, prywatne2)")
    if nazwa in stan[narz]["konta"]:
        raise Blad("konto %s/%s już istnieje (ponowne logowanie: konta.py zaloguj %s %s)" % (narz, nazwa, narz, nazwa))
    profil = DOM / narz / nazwa
    if os.path.lexists(profil):
        raise Blad("%s już istnieje — usuń go albo wybierz inną nazwę" % skroc(profil))
    utworz_katalog(DOM / narz, 0o700)
    utworz_katalog(profil, 0o700)
    OPERACJA.profil(narz, nazwa, profil)
    stan[narz]["konta"][nazwa] = {"katalog": str(profil)}
    synchronizuj_profil(stan, narz, nazwa)
    if narz == "claude":
        synchronizuj_mcp(stan)
    zapisz_stan(stan)
    if args.bez_logowania or NA_SUCHO:
        krok("logowanie: konta.py zaloguj %s %s" % (narz, nazwa))
    else:
        zaloguj_konto(stan, narz, nazwa)
    print("Przełączenie na to konto: konta uzyj %s %s" % (narz, nazwa))


def zaloguj_konto(stan, narz, nazwa):
    opis = NARZEDZIA[narz]
    print("Logowanie %s, konto \"%s\" — oficjalny przepływ %s w przeglądarce. Zaloguj się kontem, "
          "które ma należeć do tego profilu." % (opis["nazwa"], nazwa, "Anthropic" if narz == "claude" else "OpenAI"))
    try:
        kod = subprocess.call(opis["zaloguj"], env=srodowisko(stan, narz, nazwa))
    except FileNotFoundError:
        raise Blad("nie znalazłem polecenia %s" % opis["zaloguj"][0])
    if kod != 0:
        uwaga("logowanie nie powiodło się (kod %s) — spróbuj ponownie: konta.py zaloguj %s %s" % (kod, narz, nazwa))


def zaloguj(args):
    stan = wczytaj_stan()
    sprawdz_konto(stan, args.narzedzie, args.nazwa)
    if NA_SUCHO:
        krok("%s w profilu %s" % (" ".join(NARZEDZIA[args.narzedzie]["zaloguj"]), args.nazwa))
        return
    zaloguj_konto(stan, args.narzedzie, args.nazwa)


def uzyj(args):
    stan = wczytaj_stan()
    narz, nazwa = args.narzedzie, args.nazwa
    sprawdz_konto(stan, narz, nazwa)
    if nazwa != GLOWNE:
        synchronizuj_profil(stan, narz, nazwa)
    if narz == "claude":
        synchronizuj_mcp(stan)
    stan[narz]["aktywne"] = nazwa
    zapisz_stan(stan)
    napisz_env(stan)
    if NA_SUCHO:
        return
    print("Aktywne konto %s: %s. Nowe okna terminala już go używają; w tym oknie: source ~/.konta/env.sh "
          "(funkcja `konta` robi to sama)." % (NARZEDZIA[narz]["nazwa"], nazwa))
    print("Otwarte sesje działają dalej na poprzednim koncie. Historia jest wspólna: %s"
          % ("claude --resume" if narz == "claude" else "codex resume"))


def status_logowania(stan, narz, nazwa):
    """Pyta oficjalne CLI o stan logowania profilu. Wypisuje tylko e-mail / opis, nigdy tokenów."""
    polecenie = ["claude", "auth", "status", "--json"] if narz == "claude" else ["codex", "login", "status"]
    try:
        r = subprocess.run(polecenie, env=srodowisko(stan, narz, nazwa), capture_output=True, text=True,
                           timeout=30, stdin=subprocess.DEVNULL)
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        return None, "nie sprawdzono (%s)" % e.__class__.__name__
    if narz == "claude":
        try:
            d = json.loads(r.stdout)
        except ValueError:
            return None, "nie sprawdzono"
        if not d.get("loggedIn"):
            return False, "niezalogowane"
        return True, "zalogowane%s" % (" (%s)" % d["email"] if d.get("email") else "")
    tekst = (r.stdout or r.stderr).strip().splitlines()
    tekst = tekst[0] if tekst else ""
    if not tekst:
        return None, "nie sprawdzono"
    if tekst.lower().startswith("not logged"):
        return False, "niezalogowane"
    return True, "zalogowane (%s)" % tekst.split(" using ", 1)[1] if " using " in tekst else tekst


def stan_cmd(args):
    stan = wczytaj_stan()
    for narz, opis in NARZEDZIA.items():
        if narz not in stan:
            continue
        aktywne = stan[narz]["aktywne"]
        print("%s (aktywne: %s)" % (opis["nazwa"], aktywne))
        glowny = katalog_konta(stan, narz, GLOWNE)
        for nazwa, dane in stan[narz]["konta"].items():
            kat = Path(dane["katalog"])
            _, logowanie = status_logowania(stan, narz, nazwa)
            linia = "  %s %-12s %-28s %s" % ("●" if nazwa == aktywne else " ", nazwa, skroc(kat), logowanie)
            if nazwa != GLOWNE:
                wpisy = wpisy_wspolne(narz, glowny)
                ok = sum(1 for n in wpisy if os.path.islink(kat / n) and os.readlink(kat / n) == str(glowny / n))
                linia += "  · wspólne %d/%d" % (ok, len(wpisy))
                if narz == "claude":
                    tylko = sorted(set((wczytaj_json(kat / ".claude.json", {}) or {}).get("mcpServers") or {})
                                   - set(stan["claude"].get("mcp_z_glownego", [])))
                    if tylko:
                        linia += "  · MCP tylko tutaj: %s" % ", ".join(tylko)
            print(linia)
        oczekiwane = None if aktywne == GLOWNE and not stan[narz].get("glowny_jawny") else katalog_doslownie(stan, narz, aktywne)
        if os.environ.get(opis["zmienna"]) != oczekiwane:
            print("  (to okno terminala ma inne ustawienie — otwórz nowe albo: source ~/.konta/env.sh)")
    b = stan.get("bramka") or {}
    if b.get("wlaczona"):
        print("Bramka: włączona dla %s, adres %s%s" % (", ".join(b.get("narzedzia", [])), b.get("adres"),
                                                       ", model w Claude Code: %s" % b["model"] if b.get("model") else ""))
    else:
        print("Bramka: wyłączona (normalne logowanie)")


def synchronizuj(args):
    stan = wczytaj_stan()
    for narz in NARZEDZIA:
        for nazwa in (stan.get(narz) or {}).get("konta", {}):
            if nazwa != GLOWNE:
                synchronizuj_profil(stan, narz, nazwa)
    synchronizuj_mcp(stan)
    zapisz_stan(stan)
    napisz_env(stan)


def usun_profil(stan, narz, nazwa, sciezka):
    """Oficjalne wylogowanie (jeśli zalogowane) i usunięcie katalogu profilu. Dowiązania usuwamy
    jako dowiązania — dane wspólne w katalogu głównym zostają nietknięte."""
    profil = Path(sciezka)
    if not profil.is_dir():
        return
    if not str(os.path.realpath(profil)).startswith(str(os.path.realpath(DOM)) + os.sep):
        raise Blad("odmawiam usunięcia %s — to nie jest profil w %s" % (profil, skroc(DOM)))
    if stan and narz in stan and nazwa in stan[narz]["konta"]:
        zalogowane, _ = status_logowania(stan, narz, nazwa)
        if zalogowane:
            krok("wylogowanie (%s) w profilu %s" % (" ".join(NARZEDZIA[narz]["wyloguj"]), nazwa))
            if not NA_SUCHO:
                subprocess.call(NARZEDZIA[narz]["wyloguj"], env=srodowisko(stan, narz, nazwa), stdin=subprocess.DEVNULL)
    krok("usuwam profil %s (dane wspólne zostają)" % skroc(profil))
    if NA_SUCHO:
        return
    for n in os.listdir(profil):
        if os.path.islink(profil / n):
            os.unlink(profil / n)
    shutil.rmtree(profil)


def usun(args):
    stan = wczytaj_stan()
    narz, nazwa = args.narzedzie, args.nazwa
    sprawdz_konto(stan, narz, nazwa)
    if nazwa == GLOWNE:
        raise Blad("konta głównego nie usuwam (wylogowanie: %s)" % " ".join(NARZEDZIA[narz]["wyloguj"]))
    if stan[narz]["aktywne"] == nazwa:
        stan[narz]["aktywne"] = GLOWNE
        krok("aktywne konto %s -> %s" % (narz, GLOWNE))
    usun_profil(stan, narz, nazwa, katalog_konta(stan, narz, nazwa))
    del stan[narz]["konta"][nazwa]
    zapisz_stan(stan)
    napisz_env(stan)
    print("Uwaga: usuniętego logowania nie przywróci --cofnij — w razie potrzeby dodaj konto ponownie.")


# ---------------------------------------------------------------- bramka (modele innych dostawców)

def zapisz_token(token):
    """Token dostępu do bramki trafia do pęku kluczy systemu; nie do plików konfiguracyjnych Claude."""
    uzytkownik = os.environ.get("USER") or getpass.getuser()
    if sys.platform == "darwin":
        # `security -i` czyta polecenie ze stdin, więc token nie pojawia się na liście procesów.
        polecenie = 'add-generic-password -U -a %s -s %s -w %s\n' % (
            json.dumps(uzytkownik), USLUGA_TOKENU, json.dumps(token))
        r = subprocess.run(["security", "-i"], input=polecenie, text=True, capture_output=True)
        if r.returncode != 0:
            raise Blad("nie udało się zapisać tokenu w pęku kluczy: %s" % r.stderr.strip())
        odczyt = 'security find-generic-password -a "${USER:-$(id -un)}" -s %s -w' % USLUGA_TOKENU
    elif shutil.which("secret-tool"):
        r = subprocess.run(["secret-tool", "store", "--label=Token dostępu do bramki", "service", USLUGA_TOKENU,
                            "user", uzytkownik], input=token, text=True, capture_output=True)
        if r.returncode != 0:
            raise Blad("nie udało się zapisać tokenu (secret-tool): %s" % r.stderr.strip())
        odczyt = 'secret-tool lookup service %s user "${USER:-$(id -un)}"' % USLUGA_TOKENU
    else:
        uwaga("brak magazynu haseł (secret-tool) — token w pliku ~/.konta/token-bramki (tylko dla Ciebie)")
        plik = DOM / "token-bramki"
        zapisz_plik(plik, token, 0o600, "token dostępu do bramki -> %s" % skroc(plik))
        odczyt = 'cat "$HOME/.konta/token-bramki"'
    zapisz_plik(POMOCNIK, "#!/bin/sh\n# Zwraca token dostępu do bramki (Claude Code: apiKeyHelper).\nexec %s\n" % odczyt,
                0o700, "pomocnik %s (odczyt tokenu z pęku kluczy)" % skroc(POMOCNIK))


def modele_bramki(adres, token):
    req = urllib.request.Request(adres.rstrip("/") + "/v1/models",
                                 headers={"Authorization": "Bearer " + token, "X-Api-Key": token})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            dane = json.load(r)
    except Exception as e:  # noqa: BLE001 — każdy błąd sieci/odpowiedzi kończy się tym samym komunikatem
        raise Blad("bramka nie odpowiada poprawnie na %s/v1/models (%s)" % (adres, e))
    return sorted(m.get("id") for m in dane.get("data", []) if isinstance(m, dict) and m.get("id"))


def plik_ustawien_claude(stan):
    return katalog_konta(stan, "claude", GLOWNE) / "settings.json"


def plik_konfiguracji_codex(stan):
    return katalog_konta(stan, "codex", GLOWNE) / "config.toml"


def codex_bez_bramki(tekst):
    tekst = re.sub(r"\n?%s.*?%s\n?" % (re.escape(CODEX_BLOK_START), re.escape(CODEX_BLOK_KONIEC)), "", tekst, flags=re.S)
    tekst = re.sub(r"^.*%s\n?" % re.escape(CODEX_ZNACZNIK), "", tekst, flags=re.M)
    return re.sub(r"^%s" % re.escape(CODEX_POPRZEDNIO), "", tekst, flags=re.M)


def codex_z_bramka(tekst, adres, token):
    tekst = codex_bez_bramki(tekst)
    linie, gora = [], True
    for l in tekst.split("\n"):
        if l.lstrip().startswith("["):
            gora = False
        linie.append(CODEX_POPRZEDNIO + l if gora and re.match(r"\s*model_provider\s*=", l) else l)
    blok = "\n".join([
        CODEX_BLOK_START,
        "[model_providers.bramka]",
        'name = "Bramka"',
        "base_url = %s" % json.dumps(adres.rstrip("/") + "/v1"),
        'wire_api = "responses"',
        "requires_openai_auth = true",
        "supports_websockets = false",
        "http_headers = { \"X-Api-Key\" = %s }" % json.dumps(token),
        CODEX_BLOK_KONIEC,
    ])
    reszta = "\n".join(linie)
    if reszta and not reszta.endswith("\n"):
        reszta += "\n"
    return 'model_provider = "bramka"%s\n%s\n%s\n' % (CODEX_ZNACZNIK, reszta, blok)


def bramka_wlacz(args):
    stan = wczytaj_stan()
    adres = args.adres.rstrip("/")
    if not re.match(r"^https?://[^\s]+$", adres):
        raise Blad("--adres: pełny adres bramki, np. https://bramka.example.com")
    narzedzia = [n for n in ("claude", "codex") if getattr(args, n)] or \
        ([] if args.desktop else [n for n in ("claude", "codex") if n in stan])
    for n in narzedzia:
        sprawdz_narzedzie(stan, n)
    if args.model and args.model.lower().startswith("claude"):
        raise Blad(ZASADA + " Wybierz model innego dostawcy.")
    print(ZASADA)
    token, modele = None, []
    if not NA_SUCHO:
        try:
            token = os.environ.get("BRAMKA_TOKEN") or getpass.getpass("Token dostępu do bramki: ")
        except (EOFError, KeyboardInterrupt):
            raise Blad("brak tokenu — uruchom tę komendę w swoim terminalu i wpisz token, gdy poprosi")
        if not token.strip():
            raise Blad("brak tokenu dostępu do bramki")
        token = token.strip()
        if not re.match(r'^[!#-\[\]-~]+$', token):
            raise Blad("token zawiera niedozwolone znaki (spacje, cudzysłów, ukośnik wsteczny)")
        modele = [m for m in modele_bramki(adres, token) if not m.lower().startswith("claude")]
        print("  Modele innych dostawców w bramce: %s" % (", ".join(modele) or "(brak)"))
        if "claude" in narzedzia and not args.model:
            raise Blad("dla Claude Code podaj --model <model z listy powyżej>")
        if args.model and modele and args.model not in modele:
            raise Blad("bramka nie ma modelu %s" % args.model)
        zapisz_token(token)
    elif "claude" in narzedzia and not args.model:
        raise Blad("dla Claude Code podaj --model <model innego dostawcy>")
    b = stan.setdefault("bramka", {})
    if "claude" in narzedzia:
        sciezka = plik_ustawien_claude(stan)
        ust = wczytaj_json(sciezka, {}) or {}
        if "claude_poprzednie" not in b:
            env = ust.get("env") or {}
            b["claude_poprzednie"] = {"klucze": {k: ust[k] for k in CLAUDE_BRAMKA_KLUCZE if k in ust},
                                      "env": {k: env[k] for k in CLAUDE_BRAMKA_ENV if k in env},
                                      "env_istnial": "env" in ust}
        ust["apiKeyHelper"] = str(POMOCNIK)
        ust["model"] = args.model
        env = ust.setdefault("env", {})
        env["ANTHROPIC_BASE_URL"] = adres
        for k in CLAUDE_BRAMKA_ENV[1:]:
            env[k] = args.model
        zapisz_json(sciezka, ust, opis="Claude Code: bramka %s, model %s (%s)" % (adres, args.model, skroc(sciezka)))
    if "codex" in narzedzia:
        sciezka = plik_konfiguracji_codex(stan)
        tekst = Path(sciezka).read_text(encoding="utf-8") if Path(sciezka).exists() else ""
        zapisz_plik(sciezka, codex_z_bramka(tekst, adres, token or "<token>"), 0o600,
                    "Codex: [model_providers.bramka] + model_provider = \"bramka\" (%s)" % skroc(sciezka))
    if args.desktop:
        claude_desktop(stan, b, adres, True, modele)
    b.update({"wlaczona": True, "adres": adres, "model": args.model,
              "narzedzia": sorted(set(b.get("narzedzia", [])) | set(narzedzia) | ({"desktop"} if args.desktop else set()))})
    zapisz_stan(stan)
    print("Gotowe. Uruchom ponownie Claude Code / Codex. Powrót: konta.py bramka wylacz")


def bramka_wylacz(args):
    stan = wczytaj_stan()
    b = stan.get("bramka") or {}
    if not b.get("wlaczona"):
        print("Bramka jest już wyłączona.")
        return
    if "claude" in b.get("narzedzia", []):
        sciezka = plik_ustawien_claude(stan)
        ust = wczytaj_json(sciezka, {}) or {}
        pop = b.get("claude_poprzednie") or {"klucze": {}, "env": {}}
        for k in CLAUDE_BRAMKA_KLUCZE:
            ust.pop(k, None)
        ust.update(pop["klucze"])
        env = ust.get("env") or {}
        for k in CLAUDE_BRAMKA_ENV:
            env.pop(k, None)
        env.update(pop["env"])
        if env or pop.get("env_istnial"):
            ust["env"] = env
        else:
            ust.pop("env", None)
        zapisz_json(sciezka, ust, opis="Claude Code: powrót do normalnego logowania (%s)" % skroc(sciezka))
    if "codex" in b.get("narzedzia", []):
        sciezka = plik_konfiguracji_codex(stan)
        if Path(sciezka).exists():
            zapisz_plik(sciezka, codex_bez_bramki(Path(sciezka).read_text(encoding="utf-8")), None,
                        "Codex: usunięty provider bramki, przywrócony poprzedni model_provider")
    if "desktop" in b.get("narzedzia", []):
        claude_desktop(stan, b, None, False, [])
    stan["bramka"] = {"wlaczona": False}
    zapisz_stan(stan)
    print("Gotowe. Token dostępu do bramki został w pęku kluczy (usługa %s). Uruchom ponownie aplikacje." % USLUGA_TOKENU)


def claude_desktop(stan, b, adres, wlacz, modele):
    """Claude Desktop (macOS): profil „third-party inference” z bramką i przełącznik deploymentMode.
    Wyłączenie przywraca poprzedni tryb, czyli normalne logowanie kontem Claude."""
    if sys.platform != "darwin":
        uwaga("Claude Desktop: tylko macOS — pomijam")
        return
    baza = Path.home() / "Library" / "Application Support" / "Claude-3p"
    meta_p, cfg_p = baza / "configLibrary" / "_meta.json", baza / "claude_desktop_config.json"
    meta = wczytaj_json(meta_p, {"appliedId": "", "entries": []}) or {"appliedId": "", "entries": []}
    cfg = wczytaj_json(cfg_p, {}) or {}
    if wlacz:
        ident = next((e["id"] for e in meta["entries"] if e.get("name") == "Bramka (konta.py)"), None) \
            or hashlib.sha256(adres.encode()).hexdigest()[:8] + "-konta"
        prof = {"inferenceProvider": "gateway", "inferenceGatewayBaseUrl": adres,
                "inferenceCredentialKind": "helper-script", "inferenceCredentialHelper": str(POMOCNIK),
                "inferenceGatewayAuthScheme": "bearer", "inferenceModels": [{"name": m} for m in modele]}
        zapisz_json(baza / "configLibrary" / (ident + ".json"), prof, 0o600, "Claude Desktop: profil bramki %s" % ident)
        b.setdefault("desktop_poprzednie", {"appliedId": meta.get("appliedId", ""), "deploymentMode": cfg.get("deploymentMode")})
        if not any(e["id"] == ident for e in meta["entries"]):
            meta["entries"].append({"id": ident, "name": "Bramka (konta.py)"})
        meta["appliedId"], cfg["deploymentMode"] = ident, "3p"
    else:
        pop = b.get("desktop_poprzednie") or {}
        meta["appliedId"] = pop.get("appliedId", "")
        if pop.get("deploymentMode"):
            cfg["deploymentMode"] = pop["deploymentMode"]
        else:
            cfg["deploymentMode"] = "1p"
    zapisz_json(meta_p, meta, 0o600, "Claude Desktop: wybrany profil")
    zapisz_json(cfg_p, cfg, 0o600, "Claude Desktop: tryb %s" % cfg["deploymentMode"])


# ---------------------------------------------------------------- cofanie

def cofnij(args):
    operacje = sorted(d for d in KOPIE.glob("*") if (d / "manifest.json").exists()) if KOPIE.is_dir() else []
    if not operacje:
        print("Nie ma nic do cofnięcia.")
        return
    katalog = operacje[-1]
    m = json.loads((katalog / "manifest.json").read_text(encoding="utf-8"))
    print("Cofam: %s (%s)" % (m["opis"], m["czas"]))
    stan = wczytaj_stan(wymagany=False)
    for w in reversed(m["wpisy"]):
        if w["typ"] == "profil":
            usun_profil(stan, w["narz"], w["nazwa"], w["sciezka"])
            continue
        p = Path(w["sciezka"])
        zmieniony = os.path.exists(p) and skrot_pliku(p) != w.get("skrot_po")
        if zmieniony and p.parent != Path(os.path.realpath(DOM)):
            tekst = p.read_text(encoding="utf-8", errors="replace")
            if RC_START in tekst:
                krok("usuwam blok konta z %s (reszta pliku bez zmian)" % skroc(p))
                if not NA_SUCHO:
                    p.write_text(re.sub(r"\n?%s.*?%s\n" % (re.escape(RC_START), re.escape(RC_KONIEC)), "", tekst, flags=re.S),
                                 encoding="utf-8")
            else:
                uwaga("%s zmienił się od tamtej operacji — nie nadpisuję. Poprzednia wersja: %s"
                      % (skroc(p), skroc(katalog / w["kopia"]) if w["kopia"] else "(plik nie istniał)"))
            continue
        if w["kopia"]:
            krok("przywracam %s" % skroc(p))
            if not NA_SUCHO:
                shutil.copy2(katalog / w["kopia"], p)
        elif os.path.exists(p):
            krok("usuwam %s (nie istniał przed operacją)" % skroc(p))
            if not NA_SUCHO:
                p.unlink()
    if not NA_SUCHO:
        (katalog / "manifest.json").rename(katalog / "manifest.cofniety.json")
        print("Cofnięte. Otwórz nowe okno terminala.")


# ---------------------------------------------------------------- main

def main(argv=None):
    global NA_SUCHO, OPERACJA
    wspolne = argparse.ArgumentParser(add_help=False)
    wspolne.add_argument("--na-sucho", action="store_true", default=argparse.SUPPRESS,
                         help="pokaż plan, niczego nie zmieniaj")
    p = argparse.ArgumentParser(prog="konta.py", description=__doc__.split("\n\n")[0],
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    # Osobna opcja (nie z `wspolne`): wspólny obiekt akcji z domyślnym False nadpisywałby --na-sucho
    # podane przed podkomendą.
    p.add_argument("--na-sucho", action="store_true", help="pokaż plan, niczego nie zmieniaj")
    p.add_argument("--cofnij", action="store_true", help="cofnij ostatnią operację")
    sub = p.add_subparsers(dest="komenda")
    sub.add_parser("instaluj", parents=[wspolne], help="przygotowanie (raz)")
    for nazwa, pomoc in (("dodaj", "nowe konto: profil + oficjalne logowanie"), ("uzyj", "przełącz aktywne konto"),
                         ("zaloguj", "zaloguj ponownie konto"), ("usun", "wyloguj i usuń konto")):
        s = sub.add_parser(nazwa, parents=[wspolne], help=pomoc)
        s.add_argument("narzedzie", choices=sorted(NARZEDZIA))
        s.add_argument("nazwa")
        if nazwa == "dodaj":
            s.add_argument("--bez-logowania", action="store_true", help="tylko profil, logowanie później")
    sub.add_parser("stan", parents=[wspolne], help="konta i aktywne konto")
    sub.add_parser("lista", parents=[wspolne], help="to samo co stan")
    sub.add_parser("synchronizuj", parents=[wspolne], help="odśwież dowiązania i MCP")
    sub.add_parser("cofnij", parents=[wspolne], help="cofnij ostatnią operację")
    b = sub.add_parser("bramka", parents=[wspolne], help="opcjonalnie: modele innych dostawców przez bramkę")
    bs = b.add_subparsers(dest="akcja", required=True)
    w = bs.add_parser("wlacz", parents=[wspolne])
    w.add_argument("--adres", required=True, help="adres bramki, np. https://bramka.example.com")
    w.add_argument("--model", help="model innego dostawcy dla Claude Code (np. z listy bramki)")
    w.add_argument("--claude", action="store_true", help="tylko Claude Code")
    w.add_argument("--codex", action="store_true", help="tylko Codex")
    w.add_argument("--desktop", action="store_true", help="także Claude Desktop (macOS)")
    bs.add_parser("wylacz", parents=[wspolne])
    args = p.parse_args(argv)
    NA_SUCHO = args.na_sucho
    komenda = "cofnij" if args.cofnij else (args.komenda or "stan")
    funkcje = {"instaluj": instaluj, "dodaj": dodaj, "zaloguj": zaloguj, "uzyj": uzyj, "stan": stan_cmd,
               "lista": stan_cmd, "synchronizuj": synchronizuj, "usun": usun, "cofnij": cofnij,
               "bramka": lambda a: (bramka_wlacz if a.akcja == "wlacz" else bramka_wylacz)(a)}
    if NA_SUCHO:
        print("NA SUCHO — nic nie zostanie zmienione. Plan:")
    OPERACJA = Operacja(" ".join(x for x in [komenda, getattr(args, "akcja", None), getattr(args, "narzedzie", None),
                                              getattr(args, "nazwa", None)] if x))
    try:
        funkcje[komenda](args)
    except Blad as e:
        print("Błąd: %s" % e, file=sys.stderr)
        return 1
    finally:
        OPERACJA.zakoncz()
    return 0


if __name__ == "__main__":
    sys.exit(main())
