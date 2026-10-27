// Logowanie do panelu: porownanie hasla w stalym czasie, adres klienta zza reverse proxy
// i limit prob (ochrona przed zgadywaniem hasla slownikiem).
//
// Limit: najwyzej LIMIT_PROB nieudanych prob z jednego IP w oknie OKNO_MS. Ostatnia
// dozwolona porazka zaklada blokade na BLOKADA_MS — w tym czasie kazda proba (takze
// z poprawnym haslem) dostaje 429 z czasem do konca blokady. Udane logowanie zeruje
// licznik IP. Stan zyje w pamieci procesu: restart kontenera panelu czysci blokady.
import crypto from 'node:crypto';

export const LIMIT_PROB = 5;
export const OKNO_MS = 15 * 60e3;
export const BLOKADA_MS = 15 * 60e3;

// Skrot SHA-256 obu stron daje bufory rownej dlugosci, wiec timingSafeEqual nie zdradza
// ani tresci, ani dlugosci hasla.
export function hasloZgodne(podane, wzorzec) {
  const w = typeof wzorzec === 'string' ? wzorzec : '';
  const a = crypto.createHash('sha256').update(typeof podane === 'string' ? podane : '').digest();
  const b = crypto.createHash('sha256').update(w).digest();
  return crypto.timingSafeEqual(a, b) && w.length > 0;
}

// Reverse proxy (Caddy, docs/vps.md) dopisuje adres, z ktorego przyszlo polaczenie, na KONCU
// X-Forwarded-For. Bierzemy wiec OSTATNI wpis; wczesniejsze klient moglby nadac sam.
// Bez naglowka (polaczenie bezposrednie, np. localhost) — adres gniazda.
export function ipKlienta(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  const ip = xff.length ? xff[xff.length - 1] : String((req.socket && req.socket.remoteAddress) || '');
  return ip.replace(/^::ffff:/, '') || 'nieznany';
}

export function komunikatBlokady(ms) {
  return `Za dużo prób. Spróbuj ponownie za ${Math.max(1, Math.ceil(ms / 60e3))} min.`;
}

export function utworzLimitProb({ max = LIMIT_PROB, oknoMs = OKNO_MS, blokadaMs = BLOKADA_MS, maxWpisow = 10000, teraz = Date.now } = {}) {
  const wpisy = new Map(); // ip -> { porazki: [znaczniki czasu], blokadaDo }
  const odswiez = (w, t) => { w.porazki = w.porazki.filter(x => x > t - oknoMs); return w; };
  function sprzatnij(t) {
    for (const [ip, w] of wpisy) if (w.blokadaDo <= t && !odswiez(w, t).porazki.length) wpisy.delete(ip);
    while (wpisy.size >= maxWpisow) wpisy.delete(wpisy.keys().next().value);
  }
  return {
    /** ms do konca blokady IP; 0 = wolno probowac */
    blokada(ip) {
      const w = wpisy.get(ip), t = teraz();
      return w && w.blokadaDo > t ? w.blokadaDo - t : 0;
    },
    /** zapisuje nieudana probe; zwraca ms blokady, jesli wlasnie sie zaczela (inaczej 0) */
    porazka(ip) {
      const t = teraz();
      let w = wpisy.get(ip);
      if (!w) { if (wpisy.size >= maxWpisow) sprzatnij(t); w = { porazki: [], blokadaDo: 0 }; wpisy.set(ip, w); }
      odswiez(w, t).porazki.push(t);
      if (w.porazki.length >= max) { w.porazki = []; w.blokadaDo = t + blokadaMs; return blokadaMs; }
      return 0;
    },
    sukces(ip) { wpisy.delete(ip); },
    get rozmiar() { return wpisy.size; },
  };
}
