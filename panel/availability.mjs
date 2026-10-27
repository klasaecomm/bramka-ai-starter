export function freshRead(at, maxAge, now = Date.now()) {
  const time = typeof at === 'number' ? at : Date.parse(at);
  return Number.isFinite(time) && time > 0 && time <= now + 5000 && now - time < maxAge;
}
export function accountsFresh(state, now = Date.now()) {
  return !state.bladKont && freshRead(state.ostatniOdczytKont, 90000, now);
}
export function quotaFresh(account, now = Date.now()) {
  const usage = account.limity;
  return !!usage && !usage.blad && !usage.nieswiezy
    && freshRead(usage.odczytano, account.provider === 'codex' ? 90000 : 360000, now);
}
export function routingReady(account, model, now = Date.now()) {
  if (account.disabled || account.unavailable) return false;
  if (account.odczyt_swiezy === false) return null;
  return !(account.cooldowns || []).some(block => {
    const until = Date.parse(block.retry_at);
    if (Number.isFinite(until) && until <= now) return false;
    return !model || block.scope !== 'model' || !block.model_key || block.model_key === model;
  });
}
