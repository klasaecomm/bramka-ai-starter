// Panel na żywo przeciw atrapie management API CLIProxyAPI i Executora.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

async function uruchom(env, atrapa) {
  const upstream = http.createServer(async (req, res) => { let b = ''; for await (const c of req) b += c; res.setHeader('Content-Type', 'application/json'); const [kod, body] = atrapa(req.url, req.method, b ? JSON.parse(b) : null); res.statusCode = kod; res.end(JSON.stringify(body)); });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening'); const up = 'http://127.0.0.1:' + upstream.address().port;
  const probe = http.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = probe.address().port; await new Promise(r => probe.close(r));
  const child = spawn(process.execPath, ['server.mjs'], {cwd: new URL('..', import.meta.url), env: {...process.env, PORT: String(port), BRAMKA_URL: up, MCP_URL: up, KLUCZ_ZARZADZANIA: 'fixture-key', PANEL_HASLO: 'fixture-password', MCP_ADMIN_EMAIL: 'admin@example.test', MCP_ADMIN_HASLO: 'x', ...env}, stdio: ['ignore', 'pipe', 'pipe']});
  await new Promise((resolve, reject) => { child.stdout.on('data', d => { if (String(d).includes('"event":"start"')) resolve(); }); child.once('exit', c => reject(Error('exit ' + c))); });
  const base = 'http://127.0.0.1:' + port;
  const login = await fetch(base + '/api/zaloguj', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({haslo: 'fixture-password'})});
  assert.doesNotMatch(login.headers.get('set-cookie'), /Secure/, 'na http://localhost ciasteczko bez Secure');
  const headers = {cookie: login.headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json', 'X-Panel': '1'};
  return {base, headers, get: async p => (await fetch(base + p, {headers})).json(), post: (p, b) => fetch(base + p, {method: 'POST', headers, body: JSON.stringify(b)}),
    stop: async () => { child.kill('SIGTERM'); await once(child, 'exit'); await new Promise(r => upstream.close(r)); }};
}
const executorPusty = url => url.endsWith('/auth/sign-in/email') ? [200, {token: 't'}] : url.startsWith('/api/integrations') || url.startsWith('/api/connections') || url.startsWith('/api/tools') ? [200, []] : null;
const czekaj = async (f, ok) => { let v; for (let i = 0; i < 60; i++) { v = await f(); if (ok(v)) return v; await new Promise(r => setTimeout(r, 25)); } return v; };

const authUrl = url => url === '/v0/management/codex-auth-url' ? [200, {url: 'https://auth.openai.com/oauth/authorize?x=1', state: 's1'}] :
  url === '/v0/management/anthropic-auth-url' ? [200, {url: 'https://claude.ai/oauth/authorize?x=1', state: 's2'}] : null;
const tydzien = (s, p, id) => s.konta.filter(k => k.provider === p).reduce((a, k) => a + k.limity.okna.find(o => o.id === id).pozostalo, 0);

test('bez kont: tryb demo z kontami ChatGPT/Codex i Claude; logowanie tylko tych dwóch; akcje na przykładach odrzucone', {timeout: 15000}, async () => {
  const p = await uruchom({}, url => executorPusty(url) || authUrl(url) || (url === '/v0/management/auth-files' ? [200, {files: []}] : [200, {}]));
  try {
    const s = await czekaj(() => p.get('/api/stan'), s => s.proxy.ok);
    assert.equal(s.demo, true); assert.equal(s.proxy.ok, true);
    assert.deepEqual(s.konta.map(k => k.provider), ['claude', 'claude', 'claude', 'codex', 'codex']);
    assert.ok(s.konta.every(k => k.email.endsWith('@example.com')));
    assert.ok(s.konta.filter(k => k.provider === 'codex').every(k => k.limity.okna.map(o => o.etykieta).join() === 'Tydzień'), 'Codex: tylko limit tygodniowy');
    assert.ok(s.konta.filter(k => k.provider === 'claude').every(k => k.limity.okna.map(o => o.etykieta).join() === '5 godzin,Tydzień · Fable,Tydzień · wszystkie modele'));
    assert.deepEqual([tydzien(s, 'codex', 'secondary_window'), tydzien(s, 'claude', 'seven_day_fable'), tydzien(s, 'claude', 'seven_day')], [196, 300, 248]);
    assert.ok(s.modele.some(m => m.provider === 'claude') && s.modele.some(m => m.provider === 'codex'));
    assert.ok(!/gemini|antigravity|google/i.test(JSON.stringify(s)));
    assert.equal((await p.post('/api/konta/usun', {nazwa: s.konta[0].nazwa})).status, 409);
    const m = await p.get('/api/mcp');
    assert.equal(m.demo, true); assert.equal(m.executor.ok, true); assert.ok(m.polaczenia.length >= 10);
    assert.equal((await p.post('/api/mcp/usun', {id: m.polaczenia[0].id})).status, 409);
    for (const dostawca of ['gemini', 'antigravity', 'toString']) assert.equal((await p.post('/api/konta/start', {dostawca})).status, 400, dostawca + ' nie jest obsługiwany');
    for (const [dostawca, host] of [['codex', 'auth.openai.com'], ['claude', 'claude.ai']]) {
      const r = await p.post('/api/konta/start', {dostawca}); assert.equal(r.status, 200); assert.equal(new URL((await r.json()).url).host, host);
    }
  } finally { await p.stop(); }
});

test('z podłączonymi kontami: prawdziwe dane Codex i Claude, inne kanały odfiltrowane, limity z api-call', {timeout: 15000}, async () => {
  const pliki = [{auth_index: 'a1', name: 'codex-a.json', provider: 'codex', email: 'a@example.test', cooldowns: []}, {auth_index: 'c1', name: 'claude-c.json', provider: 'claude', email: 'c@example.test'}, {auth_index: 'g1', name: 'ag-g.json', provider: 'antigravity', email: 'g@example.test'}];
  const odczyty = [];
  const p = await uruchom({}, (url, method, body) => executorPusty(url) ||
    (url === '/v0/management/auth-files' ? [200, {files: pliki}] :
     url === '/v0/management/auth-files/models?name=codex-a.json' ? [200, {models: [{id: 'gpt-5.5'}]}] :
     url === '/v0/management/auth-files/models?name=claude-c.json' ? [200, {models: [{id: 'claude-fable-5-1'}]}] :
     url === '/v0/management/api-call' ? (odczyty.push(body), body.url.includes('anthropic.com')
       ? [200, {status_code: 200, body: JSON.stringify({five_hour: {utilization: 7}, seven_day: {utilization: 36}, seven_day_fable: {utilization: 0}})}]
       : [200, {status_code: 200, body: JSON.stringify({plan_type: 'pro', rate_limit: {secondary_window: {used_percent: 20, limit_window_seconds: 604800}}})}]) : [200, {}]));
  try {
    const s = await czekaj(() => p.get('/api/stan'), s => !s.demo && s.konta.every(k => k.limity) && s.modele.length === 2);
    assert.equal(s.demo, false);
    assert.deepEqual(s.konta.map(k => k.provider), ['codex', 'claude']);
    assert.deepEqual(s.konta[0].limity.okna.map(o => [o.etykieta, o.pozostalo]), [['Tydzień', 80]]);
    assert.deepEqual(s.konta[1].limity.okna.map(o => [o.id, o.pozostalo]), [['five_hour', 93], ['seven_day', 64], ['seven_day_fable', 100]]);
    assert.deepEqual(s.modele.map(m => m.model), ['claude-fable-5-1', 'gpt-5.5']);
    assert.equal(odczyty.find(b => b.url.includes('anthropic.com')).header['anthropic-beta'], 'oauth-2025-04-20');
    assert.ok(odczyty.every(b => b.header.Authorization === 'Bearer $TOKEN$'), 'token konta podstawia dopiero bramka');
  } finally { await p.stop(); }
});

test('DEMO=0: nigdy danych przykładowych, Executor bez integracji = pusta lista', {timeout: 15000}, async () => {
  const p = await uruchom({DEMO: '0'}, url => executorPusty(url) || (url === '/v0/management/auth-files' ? [200, {files: []}] : [200, {}]));
  try {
    const s = await p.get('/api/stan'); assert.equal(s.demo, false); assert.equal(s.konta.length, 0);
    const m = await p.get('/api/mcp'); assert.equal(m.demo, false); assert.equal(m.polaczenia.length, 0);
  } finally { await p.stop(); }
});
