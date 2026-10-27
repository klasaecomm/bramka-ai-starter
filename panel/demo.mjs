// Dane przykładowe (tryb DEMO): wiarygodny obraz panelu, zanim podłączysz pierwsze konto.
// Same zmyślone konta ChatGPT/Codex w domenie example.com — żadnych prawdziwych adresów,
// tokenów ani wywołań. Terminy resetów liczone od "teraz", żeby odliczanie wyglądało naturalnie.
const MIN = 60e3, H = 60 * MIN, D = 24 * H;

export const DEMO_PREFIX = 'demo-';
export const jestDemo = nazwa => String(nazwa || '').startsWith(DEMO_PREFIX);

const MODELE = ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-image-2'];

// [e-mail, plan, [5 h: pozostało %, reset za], [tydzień: pozostało %, reset za], zapytania ok, błędy]
const KONTA = [
  ['sprzedaz@example.com', 'pro', [91, 2 * H + 10 * MIN], [98, 5 * D + 3 * H], 412, 3],
  ['marketing@example.com', 'plus', [38, 47 * MIN], [81, 2 * D + 6 * H], 287, 1],
  ['biuro@example.com', 'pro', [100, 4 * H + 55 * MIN], [100, 6 * D + 22 * H], 96, 0],
  ['zespol@example.com', 'team', [72, 1 * H + 32 * MIN], [64, 3 * D + 14 * H], 158, 2],
  ['wlasciciel@example.com', 'plus', [0, 26 * MIN], [57, 1 * D + 9 * H], 203, 4],
];

export function demoKonta(teraz = Date.now()) {
  const odczyt = new Date(teraz - 40e3).toISOString();
  const okno = (id, etykieta, [pozostalo, za]) => ({id, etykieta, pozostalo, reset: new Date(teraz + za).toISOString(), glowne: true});
  return KONTA.map(([email, plan, h5, tydz, ok, bledy], i) => ({
    id: DEMO_PREFIX + (i + 1), nazwa: DEMO_PREFIX + 'codex-' + (i + 1) + '.json', provider: 'codex', email,
    typKonta: '', disabled: false, unavailable: false, status: 'active', komunikat: '',
    ok, bledy, cooldowns: [], odczyt_swiezy: true,
    limity: {plan, odczytano: odczyt, blad: null, nieswiezy: false,
      okna: [okno('primary_window', '5 godzin', h5), okno('secondary_window', 'Tydzień', tydz)]},
    modele: MODELE,
  }));
}

export function demoModele(konta) {
  const m = {};
  for (const k of konta) for (const id of k.modele) (m[id] ||= {model: id, provider: k.provider, kont: 0, dostepny: true}).kont++;
  return Object.values(m);
}

// Wspólne MCP w Executorze: [id, nazwa, folder, status, narzędzi, oauth]
const MCP = [
  ['stripe', 'Stripe', 'sprzedaz', 'ok', 27, true],
  ['shopify', 'Shopify', 'sprzedaz', 'ok', 18, true],
  ['meta-ads', 'Meta Ads', 'sprzedaz', 'unconnected', 0, true],
  ['resend', 'Resend', 'sprzedaz', 'ok', 9, true],
  ['elevenlabs', 'ElevenLabs', 'tresci', 'ok', 127, true],
  ['higgsfield', 'Higgsfield', 'tresci', 'ok', 113, true],
  ['notion', 'Notion', 'tresci', 'ok', 16, true],
  ['cloudflare', 'Cloudflare', 'technologia', 'ok', 41, true],
  ['github', 'GitHub', 'technologia', 'expired', 0, true],
  ['supabase', 'Supabase', 'technologia', 'ok', 29, true],
  ['context7', 'Context7', 'dokumentacja', 'ok', 2, false],
  ['openai-docs', 'OpenAI Docs', 'dokumentacja', 'ok', 4, false],
];
export function demoMcp(publiczny) {
  const adres = publiczny + '/mcp';
  return {
    demo: true, publiczny, wspolny: {id: 'wspolny', adres},
    polaczenia: MCP.map(([id, nazwa, folder, status, narzedzi, oauth]) => ({
      id: DEMO_PREFIX + id, slug: id, nazwa, folder, url: '', aktywne: true, osiagalne: true,
      polaczone: status !== 'unconnected', brakUprawnien: false, oauthPanel: oauth, status, narzedzi,
      serwer: {id: 'wspolny', adres},
    })),
  };
}
