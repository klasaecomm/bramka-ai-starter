// Odczyt limitów konta ChatGPT/Codex -> okna panelu ({id, etykieta, pozostalo %, reset ISO, glowne}).
// Źródło: chatgpt.com/backend-api/wham/usage — okna 5 h / tydzień oraz limity dodatkowych modeli.

export const ZRODLO = {url: 'https://chatgpt.com/backend-api/wham/usage', method: 'GET', coIleS: 60};

export function procent(zuzyte) {
  return (typeof zuzyte === 'number' && Number.isFinite(zuzyte)) ? Math.round(Math.max(0, Math.min(100, 100 - zuzyte)) * 10) / 10 : null;
}
function iso(v) { return typeof v === 'number' ? new Date(v * 1000).toISOString() : (typeof v === 'string' ? v : null); }

// id okien: 'primary_window' (zwykle 5 godzin), 'secondary_window' (zwykle tydzień);
// dodatkowe modele mają prefiks z nazwą limitu i glowne=false.
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
