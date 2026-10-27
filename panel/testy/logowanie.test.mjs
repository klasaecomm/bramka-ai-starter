// Logowanie panelu: limit prob (5 porazek na IP w 15 min -> 15 min blokady, 429),
// porownanie hasla, adres klienta zza reverse proxy. Czesc jednostkowa + panel na zywo.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {hasloZgodne, ipKlienta, komunikatBlokady, utworzLimitProb, LIMIT_PROB, OKNO_MS, BLOKADA_MS} from '../logowanie.mjs';

const MIN = 60e3;
function zegar(start = 1_000_000) { const z = { t: start, teraz: () => z.t }; return z; }

test('wymagania: 5 prob w 15 min, blokada 15 min', () => {
  assert.equal(LIMIT_PROB, 5); assert.equal(OKNO_MS, 15 * MIN); assert.equal(BLOKADA_MS, 15 * MIN);
});

test('piata zla proba zaklada blokade na 15 min tylko temu IP', () => {
  const z = zegar(), l = utworzLimitProb({teraz: z.teraz});
  for (let i = 1; i <= 4; i++) { assert.equal(l.porazka('1.1.1.1'), 0, 'proba ' + i); assert.equal(l.blokada('1.1.1.1'), 0); }
  assert.equal(l.porazka('1.1.1.1'), 15 * MIN);
  assert.equal(l.blokada('1.1.1.1'), 15 * MIN);
  assert.equal(l.blokada('2.2.2.2'), 0);
  z.t += 3 * MIN; assert.equal(l.blokada('1.1.1.1'), 12 * MIN);
  z.t += 12 * MIN; assert.equal(l.blokada('1.1.1.1'), 0, 'po 15 min blokada mija');
  assert.equal(l.porazka('1.1.1.1'), 0, 'po blokadzie licznik liczy od nowa');
});

test('liczy sie tylko 15-minutowe okno', () => {
  const z = zegar(), l = utworzLimitProb({teraz: z.teraz});
  for (let i = 0; i < 4; i++) { l.porazka('ip'); z.t += MIN; }
  z.t += 15 * MIN; // cztery stare porazki wypadly z okna
  for (let i = 0; i < 4; i++) assert.equal(l.porazka('ip'), 0);
  assert.equal(l.blokada('ip'), 0);
  assert.equal(l.porazka('ip'), 15 * MIN);
});

test('udane logowanie zeruje licznik', () => {
  const l = utworzLimitProb({teraz: zegar().teraz});
  for (let i = 0; i < 4; i++) l.porazka('ip');
  l.sukces('ip');
  for (let i = 0; i < 4; i++) assert.equal(l.porazka('ip'), 0);
});

test('mapa prob ma gorna granice', () => {
  const z = zegar(), l = utworzLimitProb({teraz: z.teraz, maxWpisow: 100});
  for (let i = 0; i < 1000; i++) l.porazka('10.0.' + (i >> 8) + '.' + (i & 255));
  assert(l.rozmiar <= 100);
});

test('komunikat blokady po polsku z minutami do konca', () => {
  assert.equal(komunikatBlokady(12 * MIN), 'Za dużo prób. Spróbuj ponownie za 12 min.');
  assert.equal(komunikatBlokady(11 * MIN + 1), 'Za dużo prób. Spróbuj ponownie za 12 min.');
  assert.equal(komunikatBlokady(500), 'Za dużo prób. Spróbuj ponownie za 1 min.');
});

test('haslo porownywane w calosci, puste haslo panelu nigdy nie pasuje', () => {
  assert.equal(hasloZgodne('tajne-haslo', 'tajne-haslo'), true);
  assert.equal(hasloZgodne('tajne-hasl', 'tajne-haslo'), false);
  assert.equal(hasloZgodne('tajne-haslo-dluzsze', 'tajne-haslo'), false);
  assert.equal(hasloZgodne(undefined, 'tajne-haslo'), false);
  assert.equal(hasloZgodne('', ''), false);
  assert.equal(hasloZgodne({}, '[object Object]'), false, 'haslo musi byc napisem');
  assert.equal(hasloZgodne(['tajne-haslo'], 'tajne-haslo'), false);
});

test('IP klienta: ostatni wpis X-Forwarded-For (dopisany przez reverse proxy), bez naglowka adres gniazda', () => {
  const req = (xff, addr = '192.0.2.5') => ({headers: xff === undefined ? {} : {'x-forwarded-for': xff}, socket: {remoteAddress: addr}});
  assert.equal(ipKlienta(req('203.0.113.7')), '203.0.113.7');
  assert.equal(ipKlienta(req('6.6.6.6, 203.0.113.7')), '203.0.113.7', 'wpis podrobiony przez klienta nie zmienia IP');
  assert.equal(ipKlienta(req(undefined, '::ffff:192.0.2.9')), '192.0.2.9');
  assert.equal(ipKlienta(req(' , ')), '192.0.2.5');
});

test('panel: 5 zlych prob -> 401, szosta -> 429 z komunikatem; inne IP loguje sie; burst rownolegly nie przeskakuje limitu', async () => {
  const upstream = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(req.url.includes('auth-files') ? {files: []} : {})); });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening'); const up = 'http://127.0.0.1:' + upstream.address().port;
  const probe = http.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = probe.address().port; await new Promise(r => probe.close(r));
  const child = spawn(process.execPath, ['server.mjs'], {cwd: new URL('..', import.meta.url), env: {...process.env, PORT: String(port), BRAMKA_URL: up, MCP_URL: up, KLUCZ_ZARZADZANIA: 'fixture-key', PANEL_HASLO: 'fixture-panel-password', PANEL_SESJA: 'fixture-session'}, stdio: ['ignore', 'pipe', 'pipe']});
  const logi = []; child.stdout.on('data', d => logi.push(String(d)));
  try {
    await new Promise((resolve, reject) => { child.stdout.on('data', d => { if (String(d).includes('"event":"start"')) resolve(); }); child.once('exit', c => reject(Error('Server exited: ' + c))); setTimeout(() => reject(Error('Server startup timeout')), 5000).unref(); });
    const zaloguj = (haslo, ip) => fetch('http://127.0.0.1:' + port + '/api/zaloguj', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Forwarded-For': ip}, body: JSON.stringify({haslo})});

    for (let i = 1; i <= 5; i++) {
      const r = await zaloguj('zle-' + i, '203.0.113.10');
      assert.equal(r.status, 401, 'proba ' + i); assert.equal((await r.json()).blad, 'Złe hasło');
    }
    const szosta = await zaloguj('zle-6', '203.0.113.10');
    assert.equal(szosta.status, 429);
    assert.equal((await szosta.json()).blad, 'Za dużo prób. Spróbuj ponownie za 15 min.');
    const ra = Number(szosta.headers.get('retry-after')); assert(ra > 890 && ra <= 900, 'Retry-After ' + ra);
    assert.equal((await zaloguj('fixture-panel-password', '203.0.113.10')).status, 429, 'w blokadzie nawet dobre haslo nie przechodzi');
    assert.equal((await zaloguj('fixture-panel-password', '6.6.6.6, 203.0.113.10')).status, 429, 'podrobiony pierwszy wpis XFF nie omija blokady');
    assert(logi.join('').includes('"event":"logowanie-blokada"'));

    const inne = await zaloguj('fixture-panel-password', '203.0.113.20');
    assert.equal(inne.status, 200); assert.match(inne.headers.get('set-cookie'), /^sesja=/);

    const wyniki = await Promise.all(Array.from({length: 20}, (_, i) => zaloguj('burst-' + i, '203.0.113.30').then(r => r.status)));
    assert.equal(wyniki.filter(s => s === 401).length, 5, 'rownolegle: dokladnie 5 prob ocenionych');
    assert.equal(wyniki.filter(s => s === 429).length, 15);

    // Wolne ciala: 30 polaczen wysyla naglowki, cialo dopiero gdy wszystkie czekaja.
    const polaczenia = Array.from({length: 30}, (_, i) => {
      const body = JSON.stringify({haslo: 'wolne-' + i}), s = net.connect(port, '127.0.0.1');
      let out = ''; s.on('data', d => { out += d; });
      s.write(`POST /api/zaloguj HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nX-Forwarded-For: 203.0.113.40\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n`);
      return {s, body, koniec: once(s, 'close').then(() => out.split(' ')[1])};
    });
    await new Promise(r => setTimeout(r, 200));
    for (const p of polaczenia) p.s.write(p.body);
    const wolne = await Promise.all(polaczenia.map(p => p.koniec));
    assert.equal(wolne.filter(s => s === '401').length, 5, 'wolne ciala: dokladnie 5 prob ocenionych');
    assert.equal(wolne.filter(s => s === '429').length, 25);
  } finally { child.kill('SIGTERM'); await once(child, 'exit'); await new Promise(r => upstream.close(r)); }
});
