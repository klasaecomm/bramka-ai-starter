#!/usr/bin/env node
// Panel bramki AI: logowanie hasłem (PANEL_HASLO), pule kont ChatGPT/Codex i Claude z limitami
// (dodawanie kont przez OAuth), modele, wspólne MCP (Executor) i instrukcja podłączenia.
// Czyta management API CLIProxyAPI i odczyty limitów dostawców (api-call z podmianą $TOKEN$ —
// token nigdy nie opuszcza bramki). Nie wywołuje modeli. Nie zwraca tokenów. Zero zależności npm.
// Tryb DEMO: dane przykładowe, dopóki nie ma podłączonych kont / MCP (DEMO=auto, domyślnie).
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {createExecutorMcp} from './executor-mcp.mjs';
import {hasloZgodne, ipKlienta, komunikatBlokady, utworzLimitProb} from './logowanie.mjs';
import {accountsFresh, freshRead, quotaFresh, routingReady} from './availability.mjs';
import {ZRODLA, okna} from './limity.mjs';
import {demoKonta, demoModele, demoMcp, jestDemo} from './demo.mjs';

const bezUkosnika = v => String(v || '').replace(/\/+$/, '');
const PORT = Number(process.env.PORT || 8080);
const MARKA = String(process.env.PANEL_NAZWA || 'agents').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 24) || 'agents';
const BRAMKA = bezUkosnika(process.env.BRAMKA_URL || 'http://127.0.0.1:8317');
const KLUCZ = process.env.KLUCZ_ZARZADZANIA || '';
const HASLO = process.env.PANEL_HASLO || '';
const SESJA_SEKRET = process.env.PANEL_SESJA || crypto.randomBytes(32).toString('hex');
const SESJA_H = Number(process.env.PANEL_SESJA_H || 12);
const PANEL_ADRES = bezUkosnika(process.env.PANEL_ADRES || 'http://localhost:' + PORT);
const BRAMKA_ADRES = bezUkosnika(process.env.BRAMKA_ADRES || 'http://localhost:8317');
const MCP_URL = bezUkosnika(process.env.MCP_URL || 'http://127.0.0.1:4788');
const MCP_ADRES = bezUkosnika(process.env.MCP_ADRES || 'http://localhost:4788');
const DEMO = String(process.env.DEMO || 'auto').toLowerCase();
const COOKIE_SECURE = PANEL_ADRES.startsWith('https://') ? '; Secure' : '';
const START = Date.now();

// Konta w bramce: ChatGPT/Codex i Claude (konta Claude obsługują tylko Claude Code i Claude Desktop
// w trybie bramki, README.md). Pozostałe kanały logowania są wyłączone w konfiguracji bramki.
const DOSTAWCY = {
  codex: {url: 'codex-auth-url', provider: 'codex'},
  claude: {url: 'anthropic-auth-url', provider: 'anthropic'},
};

const executorMcp = createExecutorMcp({base: MCP_URL, publicUrl: MCP_ADRES, panelOrigin: PANEL_ADRES,
  email: process.env.MCP_ADMIN_EMAIL || '', password: process.env.MCP_ADMIN_HASLO || '',
  organization: process.env.FIRMA_SLUG || 'firma', clientName: MARKA + ' — bramka AI'});

const stan = {konta: [], modeleKont: {}, odczytyModeli: {}, konfig: {}, limity: {}, ostatniOdczytKont: 0, bladKont: null};

// ---------- klient management API --------------------------------------------
async function mgmt(sciezka, opcje = {}) {
  const r = await fetch(BRAMKA + '/v0/management/' + sciezka, {
    method: opcje.method || 'GET',
    headers: {'X-Management-Key': KLUCZ, 'Content-Type': 'application/json'},
    body: opcje.body ? JSON.stringify(opcje.body) : undefined,
    signal: AbortSignal.timeout(opcje.timeout || 20000),
  });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = null; }
  if (!r.ok) throw Object.assign(new Error((j && (j.error || j.message)) || ('HTTP ' + r.status)), {status: r.status});
  return j;
}

// ---------- konta i modele ----------------------------------------------------
let accountReadVersion = 0;
async function odczytKont() {
  const version = ++accountReadVersion;
  try {
    const d = await mgmt('auth-files');
    if (version !== accountReadVersion) return;
    const rows = (d.files || []).filter(r => Object.hasOwn(DOSTAWCY, r.provider));
    stan.konta = rows.map(r => ({
      id: r.auth_index, nazwa: r.name, provider: r.provider, email: r.email || r.account || '',
      typKonta: r.account_type || '', disabled: !!r.disabled, unavailable: !!r.unavailable,
      status: r.status || '', komunikat: r.status_message || '', nastepnaProba: r.next_retry_after || null,
      ok: r.success || 0, bledy: r.failed || 0, ostatnieOdswiezenie: r.last_refresh || null,
      cooldowns: r.cooldowns || [],
    }));
    stan.ostatniOdczytKont = Date.now(); stan.bladKont = null;
  } catch (e) { if (version === accountReadVersion) stan.bladKont = String(e.message || e); }
  try { stan.konfig = wyciagnijKonfig(await mgmt('config')); } catch { /* konfig opcjonalny */ }
}
function wyciagnijKonfig(c) {
  const r = c.routing || {};
  return {strategia: r.strategy || '', affinity: !!r['session-affinity'], affinityTtl: r['session-affinity-ttl'] || '', retry: c['request-retry'], cooldown: !c['disable-cooling']};
}
async function odczytModeliKont() {
  for (const k of stan.konta) {
    try {
      const d = await mgmt('auth-files/models?name=' + encodeURIComponent(k.nazwa));
      const lista = Array.isArray(d) ? d : (d.models || d.data || []);
      stan.modeleKont[k.id] = lista.map(m => (typeof m === 'string' ? m : (m.id || m.name || ''))).filter(Boolean);
      stan.odczytyModeli[k.id] = Date.now();
    } catch { stan.odczytyModeli[k.id] = 0; }
  }
}

// ---------- limity dostawców (api-call z $TOKEN$) ------------------------------
let limitRead = null, forceLimitRead = false;
async function odczytLimitow(wymus = false) {
  forceLimitRead ||= wymus;
  if (!limitRead) limitRead = (async () => {
    do { const force = forceLimitRead; forceLimitRead = false; await odczytLimitowOnce(force); } while (forceLimitRead);
  })().finally(() => { limitRead = null; });
  return limitRead;
}
async function odczytLimitowOnce(wymus = false) {
  if (!accountsFresh(stan)) return;
  for (const k of stan.konta) {
    const poprzedni = stan.limity[k.id];
    if (!wymus && poprzedni && poprzedni.nastepnyOdczyt > Date.now()) continue;
    const z = ZRODLA[k.provider];
    const wynik = {okna: [], plan: null, odczytano: null, blad: null, nieswiezy: false, nastepnyOdczyt: 0, porazki: 0};
    try {
      if (k.disabled) throw new Error('konto wylaczone');
      const body = {authIndex: k.id, method: z.method, url: z.url, header: {Authorization: 'Bearer $TOKEN$', 'Content-Type': 'application/json', ...z.naglowki}};
      const r = await mgmt('api-call', {method: 'POST', body});
      const kod = r.status_code;
      if (kod === 429) throw Object.assign(new Error('Odczyt limitow: HTTP 429'), {retryAfter: Number((r.headers || r.header || {})['Retry-After'] || 60)});
      if (kod !== 200) throw new Error('Odczyt limitow: HTTP ' + kod);
      let data = r.body; if (typeof data === 'string') data = JSON.parse(data);
      wynik.okna = okna(k.provider, data);
      wynik.plan = data.plan_type || null; wynik.odczytano = new Date().toISOString();
      wynik.nastepnyOdczyt = Date.now() + z.coIleS * 1000;
    } catch (e) {
      wynik.porazki = ((poprzedni && poprzedni.porazki) || 0) + 1;
      wynik.blad = /^Odczyt limitow:/.test(e.message) || e.message === 'konto wylaczone' ? e.message : 'Nie udalo sie odczytac limitow';
      wynik.nastepnyOdczyt = Date.now() + (e.retryAfter ? e.retryAfter * 1000 : Math.min(1800000, 300000 * 2 ** Math.min(wynik.porazki, 3)));
      if (poprzedni) { wynik.okna = poprzedni.okna; wynik.plan = poprzedni.plan; wynik.odczytano = poprzedni.odczytano; wynik.nieswiezy = true; }
    }
    stan.limity[k.id] = wynik;
  }
  for (const id of Object.keys(stan.limity)) if (!stan.konta.some(k => k.id === id)) delete stan.limity[id];
}

// ---------- tryb demo ---------------------------------------------------------
const demoWymuszone = ['1', 'true', 'tak'].includes(DEMO), demoWylaczone = ['0', 'false', 'nie'].includes(DEMO);
const demoKontAktywne = () => demoWymuszone || (!demoWylaczone && stan.konta.length === 0);

// ---------- JSON dla panelu -----------------------------------------------------
function proxyStan() {
  return {ok: accountsFresh(stan), blad: stan.bladKont, ostatniOdczyt: stan.ostatniOdczytKont ? new Date(stan.ostatniOdczytKont).toISOString() : null};
}
function stanJson() {
  const wspolne = {wygenerowano: new Date().toISOString(), uptimeS: Math.round((Date.now() - START) / 1000), proxy: proxyStan(), routing: stan.konfig,
    adresModeli: BRAMKA_ADRES, adresMcp: MCP_ADRES + '/mcp'};
  if (demoKontAktywne()) {
    const konta = demoKonta();
    return {...wspolne, demo: true, bladKont: null, ostatniOdczytKont: new Date(Date.now() - 40e3).toISOString(), konta, modele: demoModele(konta)};
  }
  const swiezy = accountsFresh(stan), modele = {};
  for (const k of stan.konta.filter(k => !k.disabled)) for (const m of stan.modeleKont[k.id] || []) (modele[m] ||= {provider: k.provider, konta: []}).konta.push(k.id);
  return {...wspolne, demo: false, bladKont: stan.bladKont, ostatniOdczytKont: stan.ostatniOdczytKont ? new Date(stan.ostatniOdczytKont).toISOString() : null,
    konta: stan.konta.map(k => ({...k, odczyt_swiezy: swiezy, limity: stan.limity[k.id] || null, modele: stan.modeleKont[k.id] || []})),
    modele: Object.entries(modele).map(([m, {provider, konta}]) => ({model: m, provider, kont: konta.length,
      dostepny: !swiezy || !konta.every(id => freshRead(stan.odczytyModeli[id], 630000)) ? null : konta.some(id => routingReady(stan.konta.find(x => x.id === id), m))})).sort((a, b) => a.model.localeCompare(b.model))};
}
async function mcpJson() {
  let real = null, blad = null;
  try { real = await executorMcp.state(); } catch (e) { blad = String(e.message || e); }
  const executor = {ok: !!real, blad};
  if (demoWymuszone || (!demoWylaczone && (!real || real.polaczenia.length === 0))) return {...demoMcp(MCP_ADRES), executor};
  if (!real) throw Object.assign(new Error(blad), {status: 502});
  return {...real, demo: false, executor};
}
function metryki() {
  const w = [], g = (n, h, t) => w.push(`# HELP ${n} ${h}`, `# TYPE ${n} ${t}`);
  g('bramka_panel_up', 'Czy panel ma swiezy odczyt kont z bramki (1/0)', 'gauge');
  w.push(`bramka_panel_up ${accountsFresh(stan) ? 1 : 0}`);
  g('bramka_konto_limit_pozostalo_procent', 'Pozostaly procent okna limitu dostawcy', 'gauge');
  for (const k of stan.konta) {
    if (k.disabled || !accountsFresh(stan) || !quotaFresh({...k, limity: stan.limity[k.id]})) continue;
    for (const o of (stan.limity[k.id] || {}).okna || []) if (o.pozostalo != null) w.push(`bramka_konto_limit_pozostalo_procent{provider="${k.provider}",konto="${k.id}",okno="${o.id}"} ${o.pozostalo}`);
  }
  return w.join('\n') + '\n';
}

// ---------- sesja i logowanie ------------------------------------------------
function podpis(v) { return crypto.createHmac('sha256', SESJA_SEKRET).update(v).digest('base64url'); }
function nowaSesja() { const exp = String(Date.now() + SESJA_H * 3600e3); return exp + '.' + podpis(exp); }
function sesjaOk(req) {
  const c = Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim().split('=')).filter(x => x[0]));
  const v = c.sesja; if (!v) return false;
  const [exp, sig] = v.split('.'); if (!exp || !sig || Number(exp) < Date.now()) return false;
  const a = Buffer.from(sig), b = Buffer.from(podpis(exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// Najwyżej 5 nieudanych prób na IP w 15 min, potem 15 min blokady (panel/logowanie.mjs).
const limitProb = utworzLimitProb();

// ---------- konta: dodawanie przez OAuth ----------------------------------------
const tylkoPrawdziwe = nazwa => { if (jestDemo(nazwa)) throw Object.assign(new Error('To konto przykładowe (tryb demo) — podłącz własne przyciskiem „Połącz konto”.'), {status: 409}); };
const dostawca = d => { const p = Object.hasOwn(DOSTAWCY, d.dostawca) && DOSTAWCY[d.dostawca]; if (!p) throw Object.assign(new Error('Bramka obsługuje konta ChatGPT/Codex i Claude'), {status: 400}); return p; };
async function startKonta(d) { const r = await mgmt(dostawca(d).url); return {url: r.url, state: r.state}; }
async function dokonczKonto(d) {
  const p = dostawca(d);
  const adres = String(d.adres || '').trim(); if (!/[?&]code=/.test(adres)) throw Object.assign(new Error('Wklej cały adres z paska (musi zawierać code=…)'), {status: 400});
  await mgmt('oauth-callback', {method: 'POST', body: {provider: p.provider, redirect_url: adres, state: d.state}});
  for (let i = 0; i < 30; i++) {
    const st = await mgmt('get-auth-status?state=' + encodeURIComponent(d.state));
    if (st && st.status === 'ok') { await odczytKont(); await odczytLimitow(true); odczytModeliKont().catch(() => {}); return {ok: true}; }
    if (st && st.status === 'error') throw Object.assign(new Error(st.error || 'logowanie nieudane'), {status: 400});
    await new Promise(r => setTimeout(r, 1000));
  }
  throw Object.assign(new Error('Brak potwierdzenia logowania w 30 s — odśwież listę kont'), {status: 504});
}
async function anulujKonto(d) { try { await mgmt('oauth-session?state=' + encodeURIComponent(d.state), {method: 'DELETE'}); } catch { /* sesja mogła wygasnąć */ } return {ok: true}; }
async function usunKonto(d) { tylkoPrawdziwe(d.nazwa); await mgmt('auth-files?name=' + encodeURIComponent(d.nazwa), {method: 'DELETE'}); await odczytKont(); return {ok: true}; }
async function wlaczKonto(d) { tylkoPrawdziwe(d.nazwa); await mgmt('auth-files/status', {method: 'PATCH', body: {name: d.nazwa, disabled: !d.wlaczone}}); await odczytKont(); return {ok: true}; }

// ---------- MCP (Executor) ------------------------------------------------------
const tylkoPrawdziweMcp = id => { if (jestDemo(id)) throw Object.assign(new Error('To przykładowy MCP (tryb demo) — dodaj własny przyciskiem „Dodaj MCP”.'), {status: 409}); };

// ---------- HTTP ----------------------------------------------------------------
const plik = n => fs.readFileSync(new URL('./' + n, import.meta.url), 'utf8');
const HTML = plik('index.html').replaceAll('{{MARKA}}', MARKA);
const MODULY = {'/availability.mjs': plik('availability.mjs'), '/znaki.mjs': plik('znaki.mjs')};
function odpowiedz(res, kod, tresc, typ = 'application/json; charset=utf-8', naglowki = {}) {
  const b = typeof tresc === 'string' ? tresc : JSON.stringify(tresc);
  res.writeHead(kod, {'Content-Type': typ, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'", ...naglowki});
  res.end(b);
}
function cialo(req) {
  return new Promise((resolve, reject) => {
    let b = ''; req.setEncoding('utf8');
    req.on('data', c => { b += c; if (b.length > 65536) { reject(Object.assign(new Error('za duże'), {status: 413})); req.destroy(); } });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { reject(Object.assign(new Error('zły JSON'), {status: 400})); } });
  });
}
function stronaOAuth(kind) {
  const tytul = kind === 'success' ? 'Konto połączone' : kind === 'expired' ? 'Połączenie nie zostało zakończone' : 'Nie udało się połączyć';
  const tekst = kind === 'success' ? 'Konto i jego narzędzia zostały zapisane we wspólnym MCP.' : 'Wróć do zakładki MCP i kliknij „Połącz konto”, aby zacząć od nowa.';
  const head = HTML.split('</head>')[0];
  return head + '</head><body><main style="max-width:560px;margin:12vh auto;padding:24px"><div class="brand" style="margin-bottom:36px">' + MARKA + '<i>.</i></div><article class="box"><h1 style="font-size:26px">' + tytul + '</h1><p style="margin:18px 0 26px">' + tekst + '</p><a class="button primary" href="/#mcp">Wróć do MCP</a></article></main></body></html>';
}
const AKCJE = {
  'konta/start': startKonta, 'konta/dokoncz': dokonczKonto, 'konta/anuluj': anulujKonto, 'konta/usun': usunKonto, 'konta/wlacz': wlaczKonto,
  'mcp/dodaj': d => executorMcp.add(d),
  'mcp/odswiez': d => { tylkoPrawdziweMcp(d.id); return executorMcp.refresh(d.id); },
  'mcp/usun': d => { tylkoPrawdziweMcp(d.id); return executorMcp.remove(d.id); },
  'mcp/token': d => executorMcp.mint(d),
  'mcp/oauth/start': d => { tylkoPrawdziweMcp(d.id); return executorMcp.start(d.id, d.clientId); },
  'odswiez': async () => { await odczytKont(); await odczytLimitow(true); return {ok: true}; },
};
const lokalne = req => !req.headers['x-forwarded-for'];
const serwer = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (u.pathname === '/healthz') return odpowiedz(res, 200, {ok: true});
    if (u.pathname === '/readyz') { const ok = accountsFresh(stan); return odpowiedz(res, ok ? 200 : 503, {gotowy: ok, bladKont: stan.bladKont}); }
    if (u.pathname === '/oauth/mcp-client.json' && req.method === 'GET') return odpowiedz(res, 200, executorMcp.clientMetadata);
    if (u.pathname === '/oauth/mcp/callback' && req.method === 'GET') {
      let result; try { result = await executorMcp.callback(u.searchParams); } catch { result = {status: 502, kind: 'error'}; }
      return odpowiedz(res, result.status, stronaOAuth(result.kind), 'text/html; charset=utf-8');
    }
    if (MODULY[u.pathname] && req.method === 'GET') return odpowiedz(res, 200, MODULY[u.pathname], 'text/javascript; charset=utf-8');
    // /metrics: bez sesji tylko z połączenia bezpośredniego (bez reverse proxy).
    if (u.pathname === '/metrics') { if (!lokalne(req) && !sesjaOk(req)) return odpowiedz(res, 401, {blad: 'zaloguj się'}); return odpowiedz(res, 200, metryki(), 'text/plain; version=0.0.4; charset=utf-8'); }
    if (u.pathname === '/' && req.method === 'GET') return odpowiedz(res, 200, HTML, 'text/html; charset=utf-8');
    if (u.pathname === '/api/zaloguj' && req.method === 'POST') {
      const ip = ipKlienta(req);
      const zablokuj = ms => odpowiedz(res, 429, {blad: komunikatBlokady(ms)}, undefined, {'Retry-After': String(Math.ceil(ms / 1000))});
      if (limitProb.blokada(ip)) return zablokuj(limitProb.blokada(ip));
      const d = await cialo(req);
      // Ponowne sprawdzenie PO odczycie ciała: od tego miejsca do odpowiedzi nie ma await.
      if (limitProb.blokada(ip)) return zablokuj(limitProb.blokada(ip));
      if (!hasloZgodne(d.haslo, HASLO)) {
        if (limitProb.porazka(ip)) console.log(JSON.stringify({time: new Date().toISOString(), event: 'logowanie-blokada', ip}));
        return odpowiedz(res, 401, {blad: 'Złe hasło'});
      }
      limitProb.sukces(ip);
      return odpowiedz(res, 200, {ok: true}, undefined, {'Set-Cookie': `sesja=${nowaSesja()}; Path=/; HttpOnly${COOKIE_SECURE}; SameSite=Strict; Max-Age=${SESJA_H * 3600}`});
    }
    if (u.pathname === '/api/wyloguj') return odpowiedz(res, 200, {ok: true}, undefined, {'Set-Cookie': `sesja=; Path=/; HttpOnly${COOKIE_SECURE}; SameSite=Strict; Max-Age=0`});
    if (!u.pathname.startsWith('/api/')) return odpowiedz(res, 404, {blad: 'nie ma'});
    if (!sesjaOk(req)) return odpowiedz(res, 401, {blad: 'zaloguj się'});
    if (req.method === 'GET') {
      if (u.pathname === '/api/stan') return odpowiedz(res, 200, stanJson());
      if (u.pathname === '/api/mcp') return odpowiedz(res, 200, await mcpJson());
      if (u.pathname === '/api/mcp/uzytkownicy') return odpowiedz(res, 200, await executorMcp.users());
      return odpowiedz(res, 404, {blad: 'nie ma'});
    }
    if (req.method === 'POST') {
      if (req.headers['x-panel'] !== '1') return odpowiedz(res, 403, {blad: 'brak nagłówka panelu'});
      const f = AKCJE[u.pathname.slice(5)]; if (!f) return odpowiedz(res, 404, {blad: 'nie ma'});
      return odpowiedz(res, 200, await f(await cialo(req)));
    }
    return odpowiedz(res, 405, {blad: 'metoda'});
  } catch (e) {
    return odpowiedz(res, e.status && e.status < 600 ? e.status : 500, {blad: String(e.message || e)});
  }
});

async function petla() {
  await odczytKont(); await odczytLimitow();
  // Terminy odczytów sprawdzane co 15 s; odstępy per konto i backoff błędów zostają.
  setInterval(() => odczytKont().then(() => odczytLimitow()).catch(() => {}), 15000);
  setInterval(() => odczytModeliKont().catch(() => {}), 600000);
  odczytModeliKont().catch(() => {});
}
if (!KLUCZ || !HASLO) { console.error(JSON.stringify({time: new Date().toISOString(), event: 'start', blad: 'brak KLUCZ_ZARZADZANIA albo PANEL_HASLO (uruchom ./przygotuj.sh)'})); process.exit(1); }
serwer.listen(PORT, '0.0.0.0', () => { console.log(JSON.stringify({time: new Date().toISOString(), event: 'start', port: PORT, bramka: BRAMKA, mcp: MCP_URL, demo: DEMO})); petla(); });
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { serwer.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); });
