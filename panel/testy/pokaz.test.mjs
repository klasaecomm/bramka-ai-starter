// POKAZ=1 (publiczne demo panelu): dane przykładowe bez logowania, każdy zapis 403, zero połączeń wychodzących.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

const KOMUNIKAT = 'Tryb pokazowy — postaw własną bramkę z instrukcji';

async function uruchom(env) {
  // Atrapa bramki i Executora: w trybie pokazowym nie może dostać ani jednego żądania.
  const trafienia = [];
  const pulapka = http.createServer((req, res) => { trafienia.push(req.method + ' ' + req.url); res.end('{}'); });
  pulapka.listen(0, '127.0.0.1'); await once(pulapka, 'listening'); const up = 'http://127.0.0.1:' + pulapka.address().port;
  const probe = http.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = probe.address().port; await new Promise(r => probe.close(r));
  const child = spawn(process.execPath, ['--import', new URL('./straznik-sieci.mjs', import.meta.url).href, 'server.mjs'], {cwd: new URL('..', import.meta.url),
    env: {...process.env, PORT: String(port), BRAMKA_URL: up, MCP_URL: up, POKAZ: '', DEMO: '', KLUCZ_ZARZADZANIA: '', PANEL_HASLO: '', MCP_ADMIN_EMAIL: 'admin@example.test', MCP_ADMIN_HASLO: 'x', ...env},
    stdio: ['ignore', 'pipe', 'pipe']});
  let stderr = ''; child.stderr.on('data', d => { stderr += d; });
  try {
    await new Promise((resolve, reject) => { child.stdout.on('data', d => { if (String(d).includes('"event":"start"')) resolve(); }); child.once('exit', c => reject(Error('exit ' + c + ' ' + stderr))); });
  } catch (e) { await new Promise(r => pulapka.close(r)); throw e; }
  const base = 'http://127.0.0.1:' + port;
  return {base, trafienia, wyjscia: () => stderr.split('\n').filter(l => l.startsWith('POLACZENIE-WYCHODZACE')),
    stop: async () => { child.kill('SIGTERM'); await once(child, 'exit'); await new Promise(r => pulapka.close(r)); }};
}

test('POKAZ=1: dane demo bez logowania i bez sesji, bezpieczne nagłówki', {timeout: 15000}, async () => {
  const p = await uruchom({POKAZ: '1'});
  try {
    const strona = await fetch(p.base + '/');
    assert.equal(strona.status, 200);
    const html = await strona.text(), csp = strona.headers.get('content-security-policy');
    assert.match(csp, /frame-ancestors 'none'/);
    assert.doesNotMatch(csp, /unsafe-eval/);
    const skrypt = csp.match(/script-src ([^;]+)/)[1];
    assert.doesNotMatch(skrypt, /unsafe-inline/, 'skrypt strony dopuszczony skrótem, nie unsafe-inline');
    const inline = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
    assert.ok(skrypt.includes(`'sha256-${crypto.createHash('sha256').update(inline).digest('base64')}'`), 'skrót CSP pasuje do skryptu strony');
    assert.equal(strona.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(strona.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(strona.headers.get('x-frame-options'), 'DENY');
    assert.match(strona.headers.get('strict-transport-security'), /max-age=\d+/);
    assert.equal(strona.headers.get('set-cookie'), null);

    const r = await fetch(p.base + '/api/stan');
    assert.equal(r.status, 200, 'stan bez logowania');
    assert.equal(r.headers.get('set-cookie'), null, 'bez sesji');
    const s = await r.json();
    assert.equal(s.demo, true); assert.equal(s.proxy.ok, true);
    assert.deepEqual(s.konta.map(k => k.provider), ['claude', 'claude', 'claude', 'codex', 'codex']);
    assert.ok(s.konta.every(k => k.email.endsWith('@example.com') && k.id.startsWith('demo-')));
    assert.ok(s.modele.some(m => m.model === 'claude-fable-5-1'));

    const m = await (await fetch(p.base + '/api/mcp')).json();
    assert.equal(m.demo, true); assert.equal(m.executor.ok, true);
    assert.equal(m.polaczenia.length, 12); assert.ok(m.polaczenia.every(c => c.id.startsWith('demo-')));

    for (const sciezka of ['/healthz', '/readyz', '/availability.mjs', '/znaki.mjs']) assert.equal((await fetch(p.base + sciezka)).status, 200, sciezka);
    assert.equal((await fetch(p.base + '/', {method: 'HEAD'})).status, 200);
    for (const sciezka of ['/metrics', '/oauth/mcp-client.json', '/oauth/mcp/callback?code=x&state=y', '/.env', '/server.mjs']) assert.equal((await fetch(p.base + sciezka)).status, 404, sciezka);
  } finally { await p.stop(); }
});

test('POKAZ=1: każdy zapis i logowanie zwracają 403 z komunikatem, bez połączeń wychodzących', {timeout: 15000}, async () => {
  const p = await uruchom({POKAZ: '1'});
  try {
    const zapisy = [
      ['POST', '/api/zaloguj', {haslo: 'fixture-password'}], ['POST', '/api/konta/start', {dostawca: 'codex'}],
      ['POST', '/api/konta/dokoncz', {dostawca: 'codex', state: 's', adres: 'http://localhost/?code=x'}], ['POST', '/api/konta/anuluj', {state: 's'}],
      ['POST', '/api/konta/usun', {nazwa: 'codex-a.json'}], ['POST', '/api/konta/wlacz', {nazwa: 'codex-a.json', wlaczone: false}],
      ['POST', '/api/mcp/dodaj', {nazwa: 'x', url: 'https://mcp.example.com'}], ['POST', '/api/mcp/odswiez', {id: 'stripe'}], ['POST', '/api/mcp/usun', {id: 'stripe'}],
      ['POST', '/api/mcp/token', {email: 'a@example.com'}], ['POST', '/api/mcp/oauth/start', {id: 'stripe'}], ['POST', '/api/odswiez', {}],
      ['PUT', '/api/stan', {}], ['PATCH', '/api/konta/wlacz', {}], ['DELETE', '/api/konta/usun', undefined], ['DELETE', '/', undefined],
      ['POST', '/oauth/mcp/callback', {}], ['OPTIONS', '/api/stan', undefined],
    ];
    for (const [method, sciezka, body] of zapisy) {
      const r = await fetch(p.base + sciezka, {method, headers: {'Content-Type': 'application/json', 'X-Panel': '1'}, body: body === undefined ? undefined : JSON.stringify(body)});
      assert.equal(r.status, 403, method + ' ' + sciezka);
      assert.equal(r.headers.get('set-cookie'), null, method + ' ' + sciezka + ' bez ciasteczka');
      if (method !== 'OPTIONS') assert.equal((await r.json()).blad, KOMUNIKAT, method + ' ' + sciezka);
    }
    for (const sciezka of ['/api/mcp/uzytkownicy', '/api/wyloguj', '/api/cokolwiek']) {
      const r = await fetch(p.base + sciezka); assert.equal(r.status, 403, sciezka); assert.equal((await r.json()).blad, KOMUNIKAT);
      assert.equal(r.headers.get('set-cookie'), null);
    }
    const duze = await fetch(p.base + '/api/odswiez', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: 'x'.repeat(70000)});
    assert.equal(duze.status, 413, 'ciało ponad limit odrzucone przed odczytem');
    // Kilka okresów pętli odczytu: w pokazie nie ma jej wcale.
    await new Promise(r => setTimeout(r, 400));
    assert.deepEqual(p.trafienia, [], 'ani jednego żądania do bramki / Executora');
    assert.deepEqual(p.wyjscia(), [], 'ani jednego połączenia wychodzącego ani zapytania DNS');
  } finally { await p.stop(); }
});

test('bez POKAZ: panel dalej wymaga logowania i hasła', {timeout: 15000}, async () => {
  const p = await uruchom({KLUCZ_ZARZADZANIA: 'fixture-key', PANEL_HASLO: 'fixture-password', DEMO: '1'});
  try {
    assert.equal((await fetch(p.base + '/api/stan')).status, 401);
    assert.equal((await fetch(p.base + '/api/odswiez', {method: 'POST', headers: {'X-Panel': '1'}, body: '{}'})).status, 401);
    assert.match((await fetch(p.base + '/')).headers.get('content-security-policy'), /script-src 'self' 'unsafe-inline'/, 'domyślne nagłówki bez zmian');
    // Kontrola przyrządu: bez POKAZ panel czyta bramkę, więc pułapka i strażnik muszą to zobaczyć.
    for (let i = 0; i < 40 && !p.trafienia.length; i++) await new Promise(r => setTimeout(r, 25));
    assert.ok(p.trafienia.length > 0 && p.wyjscia().some(l => l.includes('connect')), 'strażnik sieci widzi połączenia');
  } finally { await p.stop(); }
  await assert.rejects(uruchom({}), /exit 1/, 'bez POKAZ i bez haseł panel nie startuje');
});
