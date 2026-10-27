import test from 'node:test';
import assert from 'node:assert/strict';
import {oknaClaude, oknaCodex} from '../limity.mjs';

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

test('Claude: okna 5 h / tydzień / tydzień Fable, limits[] nadpisuje stare pola i oznacza blokadę', () => {
  const o = oknaClaude({five_hour: {utilization: 7, resets_at: '2030-01-01T05:00:00Z'}, seven_day: {utilization: 36}, seven_day_opus: {utilization: 50},
    limits: [{kind: 'weekly_scoped', percent: 100, is_active: true, severity: 'critical', scope: {model: {display_name: 'Fable 5.1'}}}]});
  assert.deepEqual(o.map(w => [w.id, w.pozostalo, w.glowne, !!w.zablokowane]), [['five_hour', 93, true, false], ['seven_day', 64, true, false], ['seven_day_opus', 50, false, false], ['seven_day_fable', 0, true, true]]);
  assert.equal(o[0].reset, '2030-01-01T05:00:00Z');
});
