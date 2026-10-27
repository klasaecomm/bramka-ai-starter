import test from 'node:test';
import assert from 'node:assert/strict';
import {oknaCodex} from '../limity.mjs';

test('Codex: okna 5 h i tydzień jako pozostały procent, reset z reset_after_seconds', () => {
  const o = oknaCodex({rate_limit: {primary_window: {used_percent: 9, limit_window_seconds: 18000, reset_after_seconds: 600}, secondary_window: {used_percent: 2, limit_window_seconds: 604800, reset_at: 1893456000}}});
  assert.deepEqual(o.map(w => [w.etykieta, w.pozostalo, w.glowne]), [['5 godzin', 91, true], ['Tydzień', 98, true]]);
  assert.ok(Date.parse(o[0].reset) > Date.now());
  assert.equal(o[1].reset, '2030-01-01T00:00:00.000Z');
});

test('Codex: limity dodatkowych modeli osobno, poza głównymi oknami; brak danych = pusta lista', () => {
  const o = oknaCodex({rate_limit: {primary_window: {used_percent: 100, limit_window_seconds: 18000}},
    additional_rate_limits: [{limit_name: 'Model X', rate_limit: {primary_window: {used_percent: 40, limit_window_seconds: 604800}}}]});
  assert.deepEqual(o.map(w => [w.etykieta, w.pozostalo, w.glowne]), [['5 godzin', 0, true], ['Model X · Tydzień', 60, false]]);
  assert.deepEqual(oknaCodex({}), []);
});
