import test from 'node:test';
import assert from 'node:assert/strict';
import {createExecutorMcp} from '../executor-mcp.mjs';
const json = x => new Response(JSON.stringify(x), {headers: {'Content-Type': 'application/json'}});
const opts = (fetchImpl, panelOrigin = 'https://panel.example.test') => ({base: 'http://executor', publicUrl: 'https://mcp.example.test', panelOrigin, email: 'admin@example.test', password: 'secret', organization: 'firma', fetchImpl});

test('wszystkie połączenia mają ten sam adres i żadnych sekretów dostawców', async () => {
  const calls = [];
  const m = createExecutorMcp(opts(async (url, o) => {
    calls.push(url); if (url.endsWith('/auth/sign-in/email')) return json({token: 'admin-session'});
    if (url.endsWith('/integrations')) return json([{slug: 'higgsfield', name: 'Higgsfield', kind: 'mcp', authMethods: [{kind: 'oauth'}]}, {slug: 'docs', name: 'Docs', kind: 'mcp', authMethods: []}]);
    if (url.includes('/connections?')) return json([{integration: 'higgsfield', owner: 'org', name: 'main'}]);
    if (url.includes('/tools?')) return json([{integration: 'higgsfield', name: 'video'}]);
    throw Error('unexpected ' + url);
  }));
  const d = await m.state();
  assert.equal(d.wspolny.adres, 'https://mcp.example.test/mcp');
  assert.ok(d.polaczenia.every(p => p.serwer.adres === d.wspolny.adres));
  assert.deepEqual(d.polaczenia.map(p => [p.id, p.polaczone, p.narzedzi]), [['higgsfield', true, 1], ['docs', false, 0]]);
  assert.ok(!JSON.stringify(d).includes('admin-session'));
  assert.equal(calls.filter(u => u.endsWith('/auth/sign-in/email')).length, 1);
});

test('odświeżenie tylko pobiera listę narzędzi, nigdy ich nie wywołuje', async () => {
  const calls = [];
  const m = createExecutorMcp(opts(async u => { calls.push(u); if (u.endsWith('/auth/sign-in/email')) return json({token: 'x'}); if (u.includes('/connections?')) return json([{owner: 'org', integration: 'stripe', name: 'main'}]); if (u.endsWith('/refresh')) return json([]); throw Error('unexpected'); }));
  await m.refresh('stripe');
  assert.ok(calls.some(u => u.endsWith('/connections/org/stripe/main/refresh')));
  assert.ok(calls.every(u => !u.includes('/execute') && !u.includes('tools/call')));
});

function oauthFetch(flows, regs, probe) {
  return async (u, o) => {
    const b = o.body ? JSON.parse(o.body) : null;
    if (u.endsWith('/auth/sign-in/email')) return json({token: 'x'});
    if (u.endsWith('/integrations/resend')) return json({displayUrl: 'https://mcp.resend.com', authMethods: [{kind: 'oauth', template: 'oauth2', oauth: {}}]});
    if (u.endsWith('/oauth/clients') && o.method === 'GET') return json([]);
    if (u.endsWith('/oauth/probe')) return json(probe);
    if (u.endsWith('/oauth/clients/register-dynamic')) { regs.push(b); return json({client: 'dcr-resend'}); }
    if (u.endsWith('/oauth/clients') && o.method === 'POST') { regs.push(b); return json({client: b.slug}); }
    if (u.endsWith('/oauth/start')) { flows.push(b); return json({status: 'redirect', authorizationUrl: 'https://resend.com/authorize'}); }
    throw Error('unexpected ' + u);
  };
}
const PROBE = {authorizationUrl: 'https://resend.com/authorize', tokenUrl: 'https://api.resend.com/token', clientIdMetadataDocumentSupported: true, registrationEndpoint: 'https://api.resend.com/register'};

test('lokalny panel (http://localhost) używa rejestracji dynamicznej zamiast dokumentu klienta', async () => {
  const flows = [], regs = [];
  const m = createExecutorMcp(opts(oauthFetch(flows, regs, PROBE), 'http://localhost:8080'));
  await m.start('resend');
  assert.equal(regs[0].registrationEndpoint, PROBE.registrationEndpoint);
  assert.equal(flows[0].client, 'dcr-resend');
  assert.equal(flows[0].redirectUri, 'http://localhost:8080/oauth/mcp/callback');
});

test('publiczny panel HTTPS używa dokumentu klienta (CIMD) z własnego adresu', async () => {
  const flows = [], regs = [];
  const m = createExecutorMcp(opts(oauthFetch(flows, regs, PROBE)));
  await m.start('resend');
  assert.equal(regs[0].clientId, 'https://panel.example.test/oauth/mcp-client.json');
  assert.equal(flows[0].redirectUri, 'https://panel.example.test/oauth/mcp/callback');
});

test('dostawca tylko z CIMD na localhost: jasny komunikat zamiast zepsutego logowania', async () => {
  const m = createExecutorMcp(opts(oauthFetch([], [], {...PROBE, registrationEndpoint: undefined}), 'http://localhost:8080'));
  await assert.rejects(m.start('resend'), /publicznego adresu HTTPS/);
});

test('sesja OAuth innej organizacji nie jest kończona przez ten panel', async () => {
  const wrapped = Buffer.from(JSON.stringify({state: 'obca', orgSlug: 'inna-firma'})).toString('base64url'); let calls = 0;
  const m = createExecutorMcp(opts(async () => { calls++; throw Error('must not call executor'); }));
  for (const r of [{code: 'code'}, {error: 'access_denied'}]) assert.deepEqual(await m.callback(new URLSearchParams({state: wrapped, ...r})), {status: 400, kind: 'error'});
  assert.equal(calls, 0);
});
