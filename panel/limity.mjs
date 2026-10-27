// Odczyty limitów kont -> okna panelu ({id, etykieta, pozostalo %, reset ISO, glowne, zablokowane}).
// Claude: api.anthropic.com/api/oauth/usage (5 godzin, tydzień wszystkie modele, tydzień Fable).
// Codex: chatgpt.com/backend-api/wham/usage (okna limitu konta + limity dodatkowych modeli).

export const ZRODLA = {
  claude: {url: 'https://api.anthropic.com/api/oauth/usage', method: 'GET', coIleS: 300, naglowki: {'anthropic-beta': 'oauth-2025-04-20'}},
  codex: {url: 'https://chatgpt.com/backend-api/wham/usage', method: 'GET', coIleS: 60, naglowki: {}},
};

export function procent(zuzyte) {
  return (typeof zuzyte === 'number' && Number.isFinite(zuzyte)) ? Math.round(Math.max(0, Math.min(100, 100 - zuzyte)) * 10) / 10 : null;
}
function iso(v) { return typeof v === 'number' ? new Date(v * 1000).toISOString() : (typeof v === 'string' ? v : null); }

export function oknaClaude(data) {
  const etykiety = {five_hour: '5 godzin', seven_day: 'Tydzień · wszystkie modele', seven_day_opus: 'Opus · tydzień', seven_day_sonnet: 'Sonnet · tydzień', seven_day_fable: 'Tydzień · Fable'};
  const okna = [];
  for (const [k, l] of Object.entries(etykiety)) {
    const v = data[k];
    if (v && typeof v === 'object') okna.push({id: k, etykieta: l, pozostalo: procent(v.utilization), reset: iso(v.resets_at), glowne: ['five_hour', 'seven_day', 'seven_day_fable'].includes(k)});
  }
  for (const lim of data.limits || []) {
    if (!lim || typeof lim !== 'object') continue;
    const model = ((lim.scope || {}).model || {});
    const nazwa = String(model.display_name || model.id || '').toLowerCase();
    let k = {session: 'five_hour', weekly_all: 'seven_day'}[lim.kind];
    if (lim.kind === 'weekly_scoped' && nazwa.includes('fable')) k = 'seven_day_fable';
    if (!k) continue;
    const item = {id: k, etykieta: etykiety[k], pozostalo: procent(lim.percent), reset: iso(lim.resets_at), glowne: true, zablokowane: lim.is_active === true && lim.severity === 'critical'};
    const i = okna.findIndex(o => o.id === k); if (i >= 0) okna.splice(i, 1); okna.push(item);
  }
  return okna;
}

export function oknaCodex(data) {
  const grupy = [['', data.rate_limit || {}, true], ...((data.additional_rate_limits || []).filter(r => r && typeof r === 'object').map(r => [r.limit_name || 'Dodatkowy model', r.rate_limit || {}, false]))];
  const okna = [];
  for (const [prefiks, rate, glowne] of grupy) {
    for (const k of ['primary_window', 'secondary_window']) {
      const v = rate[k]; if (!v || typeof v !== 'object') continue;
      const etyk = {18000: '5 godzin', 604800: 'Tydzień', 2592000: 'Miesiąc'}[v.limit_window_seconds] || 'Okno limitu';
      let reset = v.reset_at; if (reset == null && typeof v.reset_after_seconds === 'number') reset = Date.now() / 1000 + v.reset_after_seconds;
      okna.push({id: prefiks + k, etykieta: (prefiks ? prefiks + ' · ' : '') + etyk, pozostalo: procent(v.used_percent), reset: iso(reset), glowne});
    }
  }
  return okna;
}

export const okna = (provider, data) => provider === 'claude' ? oknaClaude(data) : oknaCodex(data);
