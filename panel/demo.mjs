// Dane przykładowe (tryb DEMO): wiarygodny obraz panelu, zanim podłączysz pierwsze konto.
// Same zmyślone konta w domenie example.com — żadnych prawdziwych adresów, tokenów ani wywołań.
// Terminy resetów liczone od "teraz", żeby odliczanie w panelu wyglądało naturalnie.
const MIN = 60e3, H = 60 * MIN, D = 24 * H;

export const DEMO_PREFIX = 'demo-';
export const jestDemo = nazwa => String(nazwa || '').startsWith(DEMO_PREFIX);

const MODELE = {
  claude: ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-sonnet-5'],
  codex: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-5.6-sol', 'gpt-5.5', 'gpt-image-2'],
};

// [provider, e-mail, plan, okna: [id, etykieta, pozostalo %, reset za ms], zapytania ok, błędy]
const KONTA = [
  ['claude', 'sprzedaz@example.com', null, [['five_hour', '5 godzin', 93, 1 * H + 26 * MIN], ['seven_day_fable', 'Tydzień · Fable', 100, 9 * H + 46 * MIN], ['seven_day', 'Tydzień · wszystkie modele', 64, 9 * H + 46 * MIN]], 412, 3],
  ['claude', 'marketing@example.com', null, [['five_hour', '5 godzin', 97, 1 * H + 16 * MIN], ['seven_day_fable', 'Tydzień · Fable', 100, 4 * D + 6 * H], ['seven_day', 'Tydzień · wszystkie modele', 94, 4 * D + 6 * H]], 287, 1],
  ['claude', 'biuro@example.com', null, [['five_hour', '5 godzin', 88, 3 * H + 5 * MIN], ['seven_day_fable', 'Tydzień · Fable', 100, 2 * D + 3 * H], ['seven_day', 'Tydzień · wszystkie modele', 90, 2 * D + 3 * H]], 158, 2],
  ['codex', 'zespol@example.com', 'pro', [['secondary_window', 'Tydzień', 98, 5 * D + 3 * H]], 203, 0],
  ['codex', 'wlasciciel@example.com', 'plus', [['secondary_window', 'Tydzień', 98, 2 * D + 6 * H]], 96, 1],
];

export function demoKonta(teraz = Date.now()) {
  const odczyt = new Date(teraz - 40e3).toISOString();
  return KONTA.map(([provider, email, plan, okna, ok, bledy], i) => ({
    id: DEMO_PREFIX + (i + 1), nazwa: DEMO_PREFIX + provider + '-' + (i + 1) + '.json', provider, email,
    typKonta: '', disabled: false, unavailable: false, status: 'active', komunikat: '',
    ok, bledy, cooldowns: [], odczyt_swiezy: true,
    limity: {plan, odczytano: odczyt, blad: null, nieswiezy: false,
      okna: okna.map(([id, etykieta, pozostalo, za]) => ({id, etykieta, pozostalo, reset: new Date(teraz + za).toISOString(), glowne: true}))},
    modele: MODELE[provider],
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
